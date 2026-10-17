/**
 * Запуск заказа v4 в производство — ПРОТОТИП (веха 2, план п. 8;
 * «Проверка безопасности» п. 1 имеет приоритет). Экран — веха 7.
 *
 * Заказ ERP создаёт ТОТ ЖЕ писатель, что и форма ERP, — `createOrder` стора
 * (RPC `erp_create_order`): маршрут, этапы и зависимости считает ERP, а не
 * копия расчёта в Order. ERP при этом не меняется (заморожен с вехи 1):
 * связь `tz_order_id`/`tz_number` RPC принимает с 18.08 и кладёт в заказ ERP.
 *
 * Последовательность и почему она такая:
 * 1. `order_v4_launch_check` — все условия перехода в `production` (оплата,
 *    статус, права) проверяются ДО создания заказа ERP, иначе отказ перехода
 *    оставил бы в цехах сироту. Он же ставит `launch_started_at`: переход
 *    примет только заказ ERP, созданный после этой метки и с `tz_number =
 *    order_number`, — так захват `tz_order_id` чужим заказом ERP ловится.
 * 2–3. Стор ERP и его доменные слайсы — ЛЕНИВО (`import()`): статический
 *    импорт утянул бы слой данных ERP в чанк Order и в бюджет оболочки
 *    (сторож `erpImports.test.ts` пускает сюда ровно три модуля и только так).
 * 4. Черновик моста → payload формы ERP (`createOrderPayload`) + связь.
 * 5. `createOrder` глотает код ошибки (23505 клиенту не виден) и отвечает
 *    `null` и тогда, когда заказ создан, но `loadOne` его не прочитал. Поэтому
 *    при `null` спрашиваем сервер ещё раз: «уже есть» — это наш же запуск
 *    (сирота повтора), отказ — `recheck` с причиной сервера (обычно конфликт
 *    связи), иначе — не создан. Ошибку при этом уже показал тостом стор ERP.
 * 6. `order_v4_transition(production)` — `orders.erp_order_id` ставит RPC.
 *    Отказ здесь — заказ ERP уже есть: повтор запуска идемпотентен (шаг 1
 *    ответит «уже», см. `afterAlready` — у «уже» два смысла).
 *
 * Ошибки Supabase показывают тостом сами писатели (`salesTransitions`, стор
 * ERP); здесь — только итог для экрана с понятной причиной и шагом.
 */
import { launchCheck, transitionOrder } from '../api/salesTransitions';
import type { NewOrderInput } from '../../erp/store/types';
import type { SalesOrder } from '../model/types';
import { METHOD_LABEL, tzToErpDraft, type BridgeWarning } from './tzToErpDraft';

/**
 * `recheck` — отказ ПОВТОРНОЙ проверки после неудачного `createOrder`: чаще
 * всего конфликт связи (заказ ERP создан не этим запуском), но бывает и
 * другое условие, изменившееся параллельно (сняли оплату). Причину называет
 * сервер — её и показывать.
 */
export type LaunchStage = 'check' | 'bootstrap' | 'payload' | 'create' | 'transition' | 'recheck';

export type LaunchResult =
  | { ok: true; erpOrderId: string; alreadyLaunched: boolean; warnings: string[] }
  | { ok: false; reason: string; stage: LaunchStage; erpOrderId?: string };

export interface LaunchOptions {
  /** Дата запуска для заказа ERP; без неё — умолчание формы ERP (сегодня) */
  launchDate?: string;
}

const REASON = {
  check: 'Не удалось проверить готовность к запуску',
  module: 'Модуль производства не загрузился — обновите страницу и повторите',
  bootstrap: 'Справочники производства не загрузились — обновите страницу и повторите',
  payload: 'В заказе нет позиций с количеством',
  payloadBuild: 'Не удалось собрать заказ для производства',
  noLink: 'У заказа нет номера — обновите карточку',
  create: 'Не удалось создать заказ в производстве',
  transition: 'Заказ создан в производстве, но статус не обновился — повторите запуск',
  noErpId: 'Статус обновлён, но сервер не вернул заказ производства — обновите карточку',
} as const;

/**
 * Предупреждения моста — человеческим текстом. Подписей для кодов в Order
 * ещё нет (экран запуска — веха 7), поэтому словарь живёт здесь, рядом
 * с единственным потребителем. Позиция называется видом изделия: ключ
 * позиции человеку ничего не скажет.
 */
const WARNING_TEXT: { [K in BridgeWarning['kind']]: (w: Extract<BridgeWarning, { kind: K }>) => string } = {
  branding_on_mixed: () => 'нанесения идут и по крою, и по готовому изделию — производство получило «по крою», проверьте маршрут',
  dtg_no_stage: () => 'этапа для DTG в производстве нет — договоритесь с цехом отдельно',
  method_as_other: (w) => `техника «${METHOD_LABEL[w.method]}» ушла в производство как «прочее», название — в комментарии нанесения`,
  empty_grid: () => 'размерная сетка пуста — позиция не ушла в производство',
};

function warningText(w: BridgeWarning, names: Map<string, string>): string {
  const text = (WARNING_TEXT[w.kind] as (x: BridgeWarning) => string)(w);
  return `«${names.get(w.item) ?? 'Позиция'}»: ${text}`;
}

function itemNames(order: SalesOrder): Map<string, string> {
  return new Map(order.items.map((it, i) => [it.key, it.product_type.trim() || `Позиция ${i + 1}`]));
}

/** Шаг 6: перевод заказа v4 в `production` (связь с ERP ставит RPC) */
async function finish(
  order: SalesOrder,
  erpOrderId: string | null,
  alreadyLaunched: boolean,
  warnings: string[],
): Promise<LaunchResult> {
  const tr = await transitionOrder(order.id, 'production');
  if (!tr) {
    return { ok: false, stage: 'transition', reason: REASON.transition, ...(erpOrderId ? { erpOrderId } : {}) };
  }
  // id из ответа перехода — он записан в `orders.erp_order_id`, это и есть истина.
  // Нет его — связь не подтверждена, пустую строку за id не выдаём
  if (!tr.erp_order_id) {
    return { ok: false, stage: 'transition', reason: REASON.noErpId, ...(erpOrderId ? { erpOrderId } : {}) };
  }
  return { ok: true, erpOrderId: tr.erp_order_id, alreadyLaunched, warnings };
}

/**
 * Ответ «уже запущен» (`already: true`) у `order_v4_launch_check` означает
 * ДВА разных состояния, и различаются они только ФОРМОЙ ответа (миграция
 * `20261017062110_order_v4_rights.sql`):
 * - строка 734: `orders.erp_order_id` уже стоит — заказ уже переведён
 *   в `production`/`done`. `launch_started_at` в ответе НЕТ. Переход здесь
 *   получил бы отказ «Такой переход статуса недоступен», и повтор ничего
 *   не исправил бы — запуск уже состоялся, это успех без перехода;
 * - строки 755–760: сирота прошлой попытки — заказ ERP этого запуска есть,
 *   а переход не прошёл. `launch_started_at` ЕСТЬ — доводим переходом.
 * Без метки `alreadyLaunched` всегда true, а `warnings` не передаются:
 * заказ ERP создал другой запуск, наших предупреждений к нему нет.
 * Сменит сервер форму ответа — эта развилка сломается; её сторожат
 * `launch.test.ts` и e2e `order-launch.spec.ts` (мок повторяет форму).
 */
function afterAlready(
  order: SalesOrder,
  check: { erp_order_id?: string; launch_started_at?: string },
  alreadyLaunched: boolean,
  warnings: string[],
): Promise<LaunchResult> | LaunchResult {
  const erpOrderId = check.erp_order_id ?? order.erp_order_id;
  if (!check.launch_started_at) {
    if (!erpOrderId) return { ok: false, stage: 'check', reason: REASON.check };
    return { ok: true, erpOrderId, alreadyLaunched: true, warnings: [] };
  }
  return finish(order, erpOrderId, alreadyLaunched, warnings);
}

/**
 * Модули ERP — загрузчиками, каждый с новой строки `() => import(…)`.
 *
 * Форма не случайна. Сторож ERP `domainSlices.test.ts` считает любой
 * динамический импорт из `erp/screens/` экраном и требует `lazyScreen`,
 * кроме строк-загрузчиков `() => import(…)` (предзагрузка). `orderPayload`
 * лежит в `erp/screens/`, но экраном не является — это чистые функции, а то,
 * ради чего сторож заведён (стор без доменных действий), здесь закрыто явно:
 * `ensureDomainSlices()` до первого обращения к стору. ERP заморожен, править
 * его сторож ради прототипа нельзя.
 */
const ERP_MODULES = [
  () => import('../../erp/lazyScreen'),
  () => import('../../erp/store/useErpStore'),
  () => import('../../erp/screens/orders/create/orderPayload'),
] as const;

async function run(order: SalesOrder, opts: LaunchOptions): Promise<LaunchResult> {
  // 1. Проверка до создания заказа ERP
  const check = await launchCheck(order.id);
  if (!check) return { ok: false, stage: 'check', reason: REASON.check };
  if (!check.ok) return { ok: false, stage: 'check', reason: check.reason };
  if (check.already) return afterAlready(order, check, true, []);

  // 2–3. Стор ERP — лениво; без цехов маршрут выпал бы целиком
  let erp;
  try {
    const [loadLazyScreen, loadStore, loadPayload] = ERP_MODULES;
    const [lazyScreen, store, payload] = await Promise.all([loadLazyScreen(), loadStore(), loadPayload()]);
    await lazyScreen.ensureDomainSlices();
    await store.useErpStore.getState().loadBootstrap();
    erp = { store: store.useErpStore, payload };
  } catch (e) {
    // Устаревшая вкладка: чанк сборки, которой больше нет на сервере
    console.error('[launchToErp]', e);
    return { ok: false, stage: 'bootstrap', reason: REASON.module };
  }
  if (erp.store.getState().departments.length === 0) {
    return { ok: false, stage: 'bootstrap', reason: REASON.bootstrap };
  }

  // 4. Черновик моста → payload формы ERP + связь в обе стороны.
  // Сборка — чистые функции, но на данных заказа; бросок — итог `payload`,
  // а не необработанный reject у экрана
  let built;
  try {
    built = buildInput(order, opts, erp.payload);
  } catch (e) {
    console.error('[launchToErp] payload', e);
    return { ok: false, stage: 'payload', reason: REASON.payloadBuild };
  }
  if ('fail' in built) return { ok: false, stage: 'payload', reason: built.fail };
  const { input, warnings } = built;

  /**
   * 5. Создание тем же писателем, что у формы ERP.
   *
   * При ошибке (в т.ч. 23505) стор ERP САМ показывает `toast.error`
   * (`erpError`), а запуск после повторной проверки может закончиться
   * `ok: true` — заказ ERP оказался нашим. Экран вехи 7 не должен дублировать
   * ошибку и обязан явно показать итог запуска, перекрывая тост стора.
   * Бросок трактуется как `null`: он мог случиться уже ПОСЛЕ того, как RPC
   * создал заказ, — рассудит повторная проверка.
   */
  let created = null;
  try {
    created = await erp.store.getState().createOrder(input);
  } catch (e) {
    console.error('[launchToErp] createOrder', e);
  }
  if (created) return finish(order, created.id, false, warnings);

  const recheck = await launchCheck(order.id);
  if (recheck?.ok && recheck.already) return afterAlready(order, recheck, false, warnings);
  if (recheck && !recheck.ok) return { ok: false, stage: 'recheck', reason: recheck.reason };
  return { ok: false, stage: 'create', reason: REASON.create };
}

type PayloadModule = Awaited<ReturnType<(typeof ERP_MODULES)[2]>>;
type ErpInput = NewOrderInput & { tz_order_id: string; tz_number: string };

/** Шаг 4: черновик моста → вход `createOrder`, либо причина отказа */
function buildInput(
  order: SalesOrder,
  opts: LaunchOptions,
  payload: PayloadModule,
): { input: ErpInput; warnings: string[] } | { fail: string } {
  const draft = tzToErpDraft(order, opts.launchDate);
  const names = itemNames(order);
  const warnings = draft.warnings.map((w) => warningText(w, names));
  const validItems = payload.payloadItems(draft.items);
  if (validItems.length === 0) return { fail: REASON.payload };
  // Без связи заказ ERP стал бы сиротой, которую ни переход, ни повторная
  // проверка не опознают (`tz_order_id = id`, `tz_number = order_number`)
  const { tz_order_id: tzOrderId, tz_number: tzNumber } = draft.link;
  if (!tzOrderId || !tzNumber) return { fail: REASON.noLink };
  /**
   * Приведение типа, а не новая сборка: `createOrderPayload` пишет коды строками
   * (`production_type: string`) — его единственный прежний потребитель, форма
   * ERP, нетипизирован (`.jsx`), а сами значения пришли из `DraftItem` формы.
   * Связи `tz_*` в `NewOrderInput` нет (ERP заморожен), но стор передаёт поля
   * заказа в RPC как есть, а `erp_create_order` их принимает с 18.08.
   */
  const input = {
    ...payload.createOrderPayload({
      form: draft.form, validItems, notesList: [], tzDocuments: [], attachments: [],
    }),
    // `tz_number` = `order_number`: иначе переход не примет этот заказ ERP
    tz_order_id: tzOrderId,
    tz_number: tzNumber,
  } as ErpInput;
  return { input, warnings };
}

/**
 * Повторный клик во время запуска получает ТОТ ЖЕ промис: второй
 * `launch_check` сдвинул бы метку начала, и заказ ERP первого запуска
 * сервер счёл бы чужим (конфликт вместо успеха).
 */
const inFlight = new Map<string, Promise<LaunchResult>>();

export function launchToErp(order: SalesOrder, opts: LaunchOptions = {}): Promise<LaunchResult> {
  const running = inFlight.get(order.id);
  if (running) return running;
  const p = run(order, opts).finally(() => inFlight.delete(order.id));
  inFlight.set(order.id, p);
  return p;
}
