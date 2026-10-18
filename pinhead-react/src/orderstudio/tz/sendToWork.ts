/**
 * «Отправить в работу» (веха 6+7, задача 5; К1, К2, К18, К19) — одна клиентская
 * цепочка под знаком отправки стора (`beginSend` … `endSend`): правка человека
 * закрыта на всё время, путь PDF ТЗ пишет только держатель знака.
 *
 * flush → чек-лист → по группам модель и хэш (совпал с путём у всех позиций
 * группы — PDF не пересобирается) → движок → сборка → загрузка новым ключом →
 * путь в позиции → flush → пересверка хэшей по `current` → переход
 * с `p_expected_updated_at` → `applyServer` (без оптимизма).
 *
 * Повторный клик — тот же промис (по id заказа). Зовёт цепочку только
 * `tz/ui/SendPanel.jsx` (сторож `sendToWork.test.ts`).
 */
import type { SalesOrder } from '../model/types';
import { useSalesStore, type SaveState } from '../store/useSalesStore';
import { uploadTzPdf } from '../api/artworks';
import { transitionFailureKind, transitionOrderDetailed } from '../api/salesTransitions';
import { checkTzHashes } from '../bridge/tzCheck';
import { canSend, sendChecklist } from './model/sendChecklist';
import { tzDocument } from './model/tzDocument';
import { tzGroups, type TzGroup } from './model/tzGroups';
import { NO_CRYPTO_MESSAGE, defaultDigest, groupHashFromTzPath, hashFromTzPath, tzContentHash } from './model/tzHash';
import { tzFileName } from './model/tzFileName';
import type { TzCatalogs } from './model/tzDocTypes';
import type { Engine, SendDeps, SendResult, SendStage } from './sendTypes';
import { MSG_TZ_ENGINE, loadTzEngine } from './ui/tzExport';
import { APP_ORIGIN } from './appOrigin';
import { pluralize } from '../../utils/i18n';

export type { SendDeps, SendProgress, SendResult, SendStage, SendStore } from './sendTypes';

export const SEND_TEXT = {
  notOpen: 'Заказ не открыт — обновите страницу',
  locked: 'Заказ уже отправлен в работу — правка закрыта',
  outdated: 'Вышло обновление — обновите страницу, заказ не отправлен',
  conflict: 'Заказ изменён в другой вкладке — обновите страницу',
  saveFailed: 'Заказ не сохранился — проверьте связь и нажмите ещё раз',
  noCatalogs: 'Справочники ТЗ ещё не загрузились — подождите и нажмите ещё раз',
  upload: 'ТЗ не загрузилось в хранилище — проверьте связь и нажмите ещё раз',
  changed: 'Заказ изменился во время сборки ТЗ — нажмите ещё раз',
  transition: 'Заказ не отправлен — попробуйте ещё раз',
} as const;

const fail = (stage: SendStage, reason: string, conflict = false): SendResult => (
  { ok: false, stage, reason, ...(conflict ? { conflict } : {}) });

/** Сохранение не дошло: конечное состояние — свой текст, `conflict` — с флагом */
function saveFailure(stage: SendStage, st: SaveState): SendResult | null {
  if (st === 'clean' || (stage === 'flush' && st === 'dirty')) return null;
  if (st === 'conflict') return fail(stage, SEND_TEXT.conflict, true);
  if (st === 'locked' || st === 'outdated') return fail(stage, SEND_TEXT[st]);
  return fail(stage, SEND_TEXT.saveFailed);
}


/** Хэш группы уже записан у всех её позиций — PDF пересобирать не нужно */
function groupIsCurrent(order: SalesOrder, g: TzGroup, hash: string): boolean {
  const dir = `orders/${order.id.toLowerCase()}/tz/`;
  return g.items.every((it) => it.tz_pdf_path.startsWith(dir)
    && hashFromTzPath(it.tz_pdf_path) === hash && groupHashFromTzPath(it.tz_pdf_path) === g.hash8);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Сборка и загрузка PDF групп, чьё содержимое изменилось: позиция → новый путь */
async function buildChanged(order: SalesOrder, d: SendDeps): Promise<Map<string, string> | SendResult> {
  const catalogs = d.catalogs as TzCatalogs;
  const groups = tzGroups(order);
  const plan: { g: TzGroup; hash: string; doc: ReturnType<typeof tzDocument> }[] = [];
  for (const g of groups) {
    const doc = tzDocument(order, g, catalogs, { issuedOn: d.today, appOrigin: d.appOrigin });
    const hash = await tzContentHash(doc, d.digest);
    if (!groupIsCurrent(order, g, hash)) plan.push({ g, hash, doc });
  }
  const paths = new Map<string, string>();
  if (plan.length === 0) return paths;
  let engine: Engine;
  try {
    d.onStage({ stage: 'engine' });
    engine = await d.engine();
  } catch (e) {
    console.error('sendToWork: движок ТЗ', e);
    return fail('engine', MSG_TZ_ENGINE);
  }
  for (const [i, { g }] of plan.entries()) {
    const step = { group: i + 1, total: plan.length };
    let built: Awaited<ReturnType<Engine['buildTzPdf']>>;
    try {
      d.onStage({ stage: 'build', ...step });
      built = await engine.buildTzPdf({ order, groups: [g], catalogs, issuedOn: d.today, appOrigin: d.appOrigin }, { digest: d.digest });
    } catch (e) {
      // Отказ движка (`TzPdfError`) — текст человеку; сбой библиотеки — общий
      const known = e instanceof Error && e.name === 'TzPdfError';
      if (!known) console.error('sendToWork: сборка ТЗ', e);
      return fail('build', `ТЗ ${g.index} из ${g.total} не собрано: ${known ? errText(e) : 'ошибка сборки PDF — сообщите администратору'}`);
    }
    d.onStage({ stage: 'upload', ...step });
    const path = await d.api.upload(order.id, built.blob, tzFileName(order, g, built.doc, built.hash12));
    if (!path) return fail('upload', SEND_TEXT.upload);
    for (const it of g.items) paths.set(it.key, path);
  }
  return paths;
}

async function run(id: string, d: SendDeps): Promise<SendResult> {
  const token = d.store().beginSend(id);
  if (token === null) return fail('flush', SEND_TEXT.notOpen);
  try {
    d.onStage({ stage: 'flush' });
    await d.store().flush();
    const flushed = saveFailure('flush', d.store().saveState);
    if (flushed) return flushed;
    const order = d.store().current;
    if (!order || order.id !== id) return fail('flush', SEND_TEXT.notOpen);
    if (order.status !== 'draft') return fail('flush', SEND_TEXT.locked);

    d.onStage({ stage: 'check' });
    if (!d.catalogs) return fail('check', SEND_TEXT.noCatalogs);
    const items = sendChecklist(order, d.catalogs, { marginPct: null, minMarginPct: null });
    if (!canSend(items)) {
      const n = items.filter((x) => x.blocking && !x.ok).length;
      return fail('check', `Исправьте ${n} ${pluralize(n, 'пункт', 'пункта', 'пунктов')} чек-листа, чтобы отправить`);
    }
    if (!d.digest) return fail('build', NO_CRYPTO_MESSAGE);

    const built = await buildChanged(order, d);
    if (!(built instanceof Map)) return built;
    if (built.size > 0) {
      const ok = d.store().editDuringSend(token, (o) => ({
        ...o,
        items: o.items.map((it) => (built.has(it.key) ? { ...it, tz_pdf_path: built.get(it.key) as string } : it)),
      }));
      if (!ok) return saveFailure('save', d.store().saveState) ?? fail('save', SEND_TEXT.changed);
    }
    d.onStage({ stage: 'save' });
    await d.store().flush();
    const saved = saveFailure('save', d.store().saveState);
    if (saved) return saved;

    // 5б. Пересверка: в базе ровно то, что собрано, — иначе цех получил бы чужое ТЗ
    const cur = d.store().current;
    if (!cur || cur.id !== id) return fail('save', SEND_TEXT.notOpen);
    if (!(await checkTzHashes(cur, d.catalogs, d.digest)).ok) return fail('save', SEND_TEXT.changed);

    d.onStage({ stage: 'transition' });
    const { data, message } = await d.api.transition(id, cur.updated_at);
    if (!data) {
      if (transitionFailureKind(message) === 'conflict') return fail('transition', SEND_TEXT.conflict, true);
      return fail('transition', message || SEND_TEXT.transition);
    }
    d.store().applyServer({ ...data, id });
    return { ok: true };
  } catch (e) {
    console.error('sendToWork', e);
    return fail('build', errText(e) === NO_CRYPTO_MESSAGE ? NO_CRYPTO_MESSAGE : `ТЗ не собрано: ${errText(e)}`);
  } finally {
    d.store().endSend();
  }
}

const DEFAULTS: Omit<SendDeps, 'catalogs' | 'today'> = {
  digest: defaultDigest(),
  appOrigin: APP_ORIGIN,
  store: () => useSalesStore.getState(),
  api: {
    upload: uploadTzPdf,
    transition: (id, expected) => transitionOrderDetailed(id, 'ready_to_launch', undefined, expected),
  },
  engine: loadTzEngine,
  onStage: () => {},
};

const inFlight = new Map<string, Promise<SendResult>>();

/** Отправить заказ в работу; повторный вызов во время отправки — тот же промис */
export function sendToWork(orderId: string, deps: Partial<SendDeps> = {}): Promise<SendResult> {
  const running = inFlight.get(orderId);
  if (running) return running;
  const d: SendDeps = { catalogs: null, today: '', ...DEFAULTS, ...deps };
  const p = run(orderId, d).finally(() => inFlight.delete(orderId));
  inFlight.set(orderId, p);
  return p;
}
