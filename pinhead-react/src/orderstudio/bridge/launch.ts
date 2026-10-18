/**
 * Запуск заказа v4 в производство (веха 2 — прототип; веха 6+7 — с ТЗ и макетами).
 *
 * Заказ ERP создаёт ТОТ ЖЕ писатель, что и форма ERP, — `createOrder` стора
 * (RPC `erp_create_order`): маршрут, этапы и зависимости считает ERP. ERP не
 * меняется (заморожен с вехи 1): связь `tz_order_id`/`tz_number`, секции
 * `tz.documents` и `attachments` RPC принимает давно.
 *
 * Шаги (`LaunchStage`) и почему они такие:
 * 1. `check` — `order_v4_launch_check`: все условия перехода (оплата, статус,
 *    права МС в ERP, разделение обязанностей) ДО создания заказа ERP; ставит
 *    метку запуска. Ответ обязан нести `launched` (миграция J) — нет его,
 *    сервер старше фронта: отказ, а не догадка по форме ответа.
 * 2. `bootstrap` — стор ERP и его доменные слайсы ЛЕНИВО (`import()`): сторож
 *    `erpImports.test.ts` пускает сюда ровно три модуля и только так.
 * 3. `payload` — черновик моста → позиции payload формы ERP.
 * 4. `tzcheck` — модель ТЗ по данным заказа против хэша в `tz_pdf_path`
 *    (решения 42, 45): расхождение — запуск закрыт.
 * 5. `files` — копии PDF ТЗ (по копии на позицию ERP) и макетов в
 *    `erp-attachments` с ключами новой попытки (`launchFiles.ts`). Отказ —
 *    заказ ERP не создаётся (решение 24).
 * 6. `recheck` — повторный `launch_check` продлевает метку (окно 10 минут
 *    считается от последнего продления). Заказ вернули менеджеру или метку
 *    взял другой МС, пока шли копии, — запуск отменяется ДО `createOrder`.
 * 7. `create` — `createOrder` c `tz.documents` и `attachments` — одна
 *    транзакция: заказа ERP без ТЗ не бывает. Ответ `null` (23505 стор глотает,
 *    либо `loadOne` не прочитал созданный) — спрашиваем сервер ещё раз.
 * 8. `transition` — `order_v4_transition(production, p_erp_order_id)`: id
 *    заказа ERP ЭТОГО запуска; сервер сверяет его и подлинность (документы ТЗ
 *    из объектов, загруженных тем, кто ставил метку). Пост-проверка вложений
 *    (стор ERP молча выбрасывает неизвестный ключ) — предупреждение в итоге.
 *
 * Ошибки Supabase показывают тостом сами писатели (`salesTransitions`,
 * `erpFiles`, стор ERP); здесь — итог для экрана с причиной и шагом. Экран
 * обязан показать итог явно, перекрывая тост стора ERP: запуск после
 * повторной проверки может закончиться успехом.
 */
import { launchCheck, transitionOrder, type LaunchCheckResult, type TransitionResult } from '../api/salesTransitions';
import type { NewOrderInput } from '../../erp/store/types';
import type { DraftItem } from '../../erp/utils/orderForm';
import type { SalesOrder } from '../model/types';
import type { ServerPatch } from '../store/useSalesStore';
import type { TzCatalogs } from '../tz/model/tzDocTypes';
import { defaultDigest, type Digest } from '../tz/model/tzHash';
import { METHOD_LABEL, tzToErpDraft, type BridgeWarning } from './tzToErpDraft';
import { checkAttachedCount, copyLaunchFiles, planLaunchFiles, type AttPayload, type CopyDeps, type TzDocPayload } from './launchFiles';
import { checkTzHashes } from './tzCheck';

export type LaunchStage = 'check' | 'bootstrap' | 'payload' | 'tzcheck' | 'files' | 'recheck' | 'create' | 'transition';

export type LaunchResult =
  | { ok: true; erpOrderId: string; alreadyLaunched: boolean; warnings: string[]; patch?: ServerPatch }
  | { ok: false; reason: string; stage: LaunchStage; erpOrderId?: string };

export interface LaunchOptions {
  /** Дата запуска для заказа ERP; без неё — умолчание формы ERP (сегодня) */
  launchDate?: string;
  /** Справочники, по которым МС пересобирает модель ТЗ (`tzcheck`) */
  catalogs?: TzCatalogs | null;
  /** Кто запускает (`uploaded_by` документов ТЗ) */
  actor?: string;
  /** sha-256; по умолчанию — `crypto.subtle` браузера */
  digest?: Digest | null;
  /** uuid попытки и файлов; по умолчанию — `crypto.randomUUID` */
  randomId?: () => string;
  /** Сеть шага `files` — для тестов */
  files?: CopyDeps;
}

export const REASON = {
  check: 'Не удалось проверить готовность к запуску',
  oldServer: 'Сервер старой версии — обновите страницу',
  module: 'Модуль производства не загрузился — обновите страницу и повторите',
  bootstrap: 'Справочники производства не загрузились — обновите страницу и повторите',
  payload: 'В заказе нет позиций с количеством',
  payloadBuild: 'Не удалось собрать заказ для производства',
  noLink: 'У заказа нет номера — обновите карточку',
  noCatalogs: 'Справочники ТЗ не загрузились — обновите страницу и повторите',
  create: 'Не удалось создать заказ в производстве',
  transition: 'Заказ создан в производстве, но статус не обновился — повторите запуск',
  noErpId: 'Статус обновлён, но сервер не вернул заказ производства — обновите карточку',
} as const;

/** Предупреждения моста — человеческим текстом; позиция называется видом изделия */
const WARNING_TEXT: { [K in BridgeWarning['kind']]: (w: Extract<BridgeWarning, { kind: K }>) => string } = {
  branding_on_mixed: () => 'нанесения идут и по крою, и по готовому изделию — производство получило «по крою», проверьте маршрут',
  dtg_no_stage: () => 'этапа для DTG в производстве нет — договоритесь с цехом отдельно',
  method_as_other: (w) => `техника «${METHOD_LABEL[w.method]}» ушла в производство как «прочее», название — в комментарии нанесения`,
  empty_grid: () => 'размерная сетка пуста — позиция не ушла в производство',
};

/** Предупреждения моста по заказу — общие с экраном «К запуску» */
export function bridgeWarningTexts(order: SalesOrder, warnings: readonly BridgeWarning[]): string[] {
  const names = new Map(order.items.map((it, i) => [it.key, it.product_type.trim() || `Позиция ${i + 1}`]));
  return warnings.map((w) => `«${names.get(w.item) ?? 'Позиция'}»: ${(WARNING_TEXT[w.kind] as (x: BridgeWarning) => string)(w)}`);
}

const patchOf = (id: string, r: { updated_at?: string; status?: SalesOrder['status']; erp_order_id?: string | null; sent_at?: string | null }): ServerPatch => ({
  id,
  ...(r.updated_at ? { updated_at: r.updated_at } : {}),
  ...(r.status ? { status: r.status } : {}),
  ...(r.erp_order_id ? { erp_order_id: r.erp_order_id } : {}),
  ...(r.sent_at !== undefined ? { sent_at: r.sent_at } : {}),
});

/** Шаг `transition`: перевод в `production` с id заказа ERP этого запуска */
async function finish(order: SalesOrder, erpOrderId: string, alreadyLaunched: boolean, warnings: string[]): Promise<LaunchResult> {
  const tr: TransitionResult | null = await transitionOrder(order.id, 'production', undefined, undefined, erpOrderId);
  if (!tr) return { ok: false, stage: 'transition', reason: REASON.transition, erpOrderId };
  // id из ответа — он записан в `orders.erp_order_id`; нет его — связь не подтверждена
  if (!tr.erp_order_id) return { ok: false, stage: 'transition', reason: REASON.noErpId, erpOrderId };
  return { ok: true, erpOrderId: tr.erp_order_id, alreadyLaunched, warnings, patch: patchOf(order.id, tr) };
}

type CheckOk = Extract<LaunchCheckResult, { ok: true }>;

/** Ответ проверки без `launched` — сервер старше J */
const isOldServer = (c: CheckOk) => typeof (c as { launched?: unknown }).launched !== 'boolean';

/**
 * «Уже» (`already: true`): `launched === true` — заказ уже переведён, успех
 * без перехода (заказ ERP создал другой запуск — наших предупреждений к нему
 * нет); `launched === false` — сирота прошлой попытки, подлинность которой
 * сервер уже проверил: только переход с id из ответа, без копий.
 */
function afterAlready(order: SalesOrder, check: CheckOk, alreadyLaunched: boolean, warnings: string[]): Promise<LaunchResult> | LaunchResult {
  const erpOrderId = check.erp_order_id ?? (check.launched ? order.erp_order_id : null);
  if (!erpOrderId) return { ok: false, stage: 'check', reason: REASON.check };
  if (check.launched) {
    return { ok: true, erpOrderId, alreadyLaunched: true, warnings: [], patch: patchOf(order.id, { ...check, erp_order_id: erpOrderId }) };
  }
  return finish(order, erpOrderId, alreadyLaunched, warnings);
}

/**
 * Модули ERP — загрузчиками, каждый с новой строки `() => import(…)`: сторож
 * ERP `domainSlices.test.ts` считает динамический импорт из `erp/screens/`
 * экраном, кроме строк-загрузчиков. `orderPayload` — чистые функции, а стор
 * получает доменные действия явно (`ensureDomainSlices()`).
 */
const ERP_MODULES = [
  () => import('../../erp/lazyScreen'),
  () => import('../../erp/store/useErpStore'),
  () => import('../../erp/screens/orders/create/orderPayload'),
] as const;

type PayloadModule = Awaited<ReturnType<(typeof ERP_MODULES)[2]>>;
type ErpInput = NewOrderInput & { tz_order_id: string; tz_number: string };
type Built = { draft: ReturnType<typeof tzToErpDraft>; valid: DraftItem[]; warnings: string[] };

/** Шаг `payload`: черновик моста и позиции payload, либо причина отказа */
function buildDraft(order: SalesOrder, opts: LaunchOptions, payload: PayloadModule): Built | { fail: string } {
  const draft = tzToErpDraft(order, opts.launchDate);
  const valid = payload.payloadItems(draft.items);
  if (valid.length === 0) return { fail: REASON.payload };
  // Без связи заказ ERP стал бы сиротой, которую ни переход, ни проверка не опознают
  if (!draft.link.tz_order_id || !draft.link.tz_number) return { fail: REASON.noLink };
  return { draft, valid, warnings: bridgeWarningTexts(order, draft.warnings) };
}

/**
 * Вход `createOrder`. Приведение типа, а не новая сборка: `createOrderPayload`
 * пишет коды строками (его прежний потребитель — нетипизированная форма ERP).
 * Связи `tz_*` в `NewOrderInput` нет (ERP заморожен), но стор передаёт поля
 * заказа в RPC как есть; `tz_number` = `order_number`, иначе переход не примет.
 */
function inputOf(b: Built, payload: PayloadModule, tzDocs: TzDocPayload[], attachments: AttPayload[]): ErpInput {
  return {
    ...payload.createOrderPayload({ form: b.draft.form, validItems: b.valid, notesList: [], tzDocuments: tzDocs, attachments }),
    tz_order_id: b.draft.link.tz_order_id as string,
    tz_number: b.draft.link.tz_number as string,
  } as ErpInput;
}

async function loadErp() {
  const [loadLazyScreen, loadStore, loadPayload] = ERP_MODULES;
  const [lazyScreen, store, payload] = await Promise.all([loadLazyScreen(), loadStore(), loadPayload()]);
  await lazyScreen.ensureDomainSlices();
  await store.useErpStore.getState().loadBootstrap();
  return { store: store.useErpStore, payload };
}

/** Проверка запуска с разбором ответа: `null` — успех без «уже», иначе итог */
async function checkStep(order: SalesOrder, stage: 'check' | 'recheck', warnings: string[]):
Promise<{ done: Promise<LaunchResult> | LaunchResult } | null> {
  const check = await launchCheck(order.id);
  if (!check) return { done: { ok: false, stage, reason: REASON.check } };
  if (!check.ok) return { done: { ok: false, stage, reason: check.reason } };
  if (isOldServer(check)) return { done: { ok: false, stage: 'check', reason: REASON.oldServer } };
  if (check.already) return { done: afterAlready(order, check, stage === 'check', warnings) };
  return null;
}

async function run(order: SalesOrder, opts: LaunchOptions): Promise<LaunchResult> {
  const first = await checkStep(order, 'check', []);
  if (first) return first.done;

  let erp;
  try {
    erp = await loadErp();
  } catch (e) {
    // Устаревшая вкладка: чанка сборки больше нет на сервере
    console.error('[launchToErp]', e);
    return { ok: false, stage: 'bootstrap', reason: REASON.module };
  }
  if (erp.store.getState().departments.length === 0) return { ok: false, stage: 'bootstrap', reason: REASON.bootstrap };

  let built;
  try {
    built = buildDraft(order, opts, erp.payload);
  } catch (e) {
    console.error('[launchToErp] payload', e);
    return { ok: false, stage: 'payload', reason: REASON.payloadBuild };
  }
  if ('fail' in built) return { ok: false, stage: 'payload', reason: built.fail };

  if (!opts.catalogs) return { ok: false, stage: 'tzcheck', reason: REASON.noCatalogs };
  const tz = await checkTzHashes(order, opts.catalogs, opts.digest === undefined ? defaultDigest() : opts.digest);
  if (!tz.ok) return { ok: false, stage: 'tzcheck', reason: tz.reason };

  // Новый uuid попытки на каждый запуск: повтор не наступает на ключи прошлого (409)
  const plan = planLaunchFiles(order, built.valid, opts.randomId ?? (() => crypto.randomUUID()));
  const files = await copyLaunchFiles(order, plan, opts.actor ?? '', opts.files);
  if (!files.ok) return { ok: false, stage: 'files', reason: files.reason };

  const again = await checkStep(order, 'recheck', built.warnings);
  if (again) return again.done;

  // Бросок — как `null`: он мог случиться уже ПОСЛЕ того, как RPC создал заказ
  let created = null;
  try {
    created = await erp.store.getState().createOrder(inputOf(built, erp.payload, files.tzDocs, files.attachments));
  } catch (e) {
    console.error('[launchToErp] createOrder', e);
  }
  if (created) {
    const lost = checkAttachedCount(files.attachments, created.attachments ?? []);
    return finish(order, created.id, false, lost ? [...built.warnings, lost] : built.warnings);
  }
  const after = await launchCheck(order.id);
  if (after?.ok && after.already && !isOldServer(after)) return afterAlready(order, after, false, built.warnings);
  if (after && !after.ok) return { ok: false, stage: 'recheck', reason: after.reason };
  return { ok: false, stage: 'create', reason: REASON.create };
}

/**
 * Повторный клик во время запуска получает ТОТ ЖЕ промис: второй
 * `launch_check` во время копий только продлил бы метку, но второй
 * `createOrder` наткнулся бы на уникальную связь.
 */
const inFlight = new Map<string, Promise<LaunchResult>>();

export function launchToErp(order: SalesOrder, opts: LaunchOptions = {}): Promise<LaunchResult> {
  const running = inFlight.get(order.id);
  if (running) return running;
  const p = run(order, opts).finally(() => inFlight.delete(order.id));
  inFlight.set(order.id, p);
  return p;
}
