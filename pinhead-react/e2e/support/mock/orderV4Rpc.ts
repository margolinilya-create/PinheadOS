/**
 * Мок RPC заказа v4 под контракт миграции J (веха 6+7):
 * `order_v4_transition`, `order_v4_launch_check`, `order_v4_set_payment`,
 * `erp_create_order` (запись тела и вложений), `sales_set_staff`, таблицы
 * `order_events` и `erp_order_attachments`.
 *
 * Тексты отказов — `J_TEXTS`, побуквенно как в J (и в B/F, которые J
 * сохраняет). Сторож `e2e/support/mockContract.test.ts` сверяет их с файлом
 * миграции в обе стороны, а наборы `MS_PAYMENT_KINDS`/`SEND_RULES` — с
 * условиями функций. Ответы — только формой J: `updated_at` во всех трёх
 * RPC, `launched` в каждом ответе проверки запуска.
 *
 * Состояние — на каждый набор `MockExtras` своё (WeakMap). Строки заказов
 * и их версии живут в `mockSupabase.ts` — сюда они приходят через `V4Ctx`.
 * Модуль регистрирует `mockSupabase.ts`; сценарии запуска (T6) и сквозной
 * e2e (T7) дописывают его сами, паритет с J держит сторож.
 */

/** Ответ RPC ошибкой PostgREST (400 + `{ code, message }`), как у `raise exception` */
export class RpcFailure {
  readonly code: string;
  readonly message: string;
  /** HTTP-статус ответа PostgREST: `raise exception` — 400, нет функции — 404 */
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    this.code = code;
    this.message = message;
    this.status = status;
  }
}

/** Тексты J (и сохранённые ею тексты B/F) — побуквенно */
export const J_TEXTS = {
  hidden: 'Заказ не найден или недоступен',
  login: 'Нужен вход в систему',
  unknownStatus: 'Неизвестный статус заказа',
  reasonLong: 'Причина — не длиннее 500 символов',
  sendRights: 'Отправить в работу может автор заказа или руководитель',
  conflict: 'Заказ изменён в другой вкладке — обновите страницу',
  noCustomer: 'Не указан клиент',
  noDue: 'Не указан срок',
  noItems: 'В заказе нет позиций',
  noTzPdf: 'Сформируйте ТЗ — PDF позиции не найден в хранилище',
  noArtwork: 'У нанесения нет макета',
  returnRights: 'Вернуть заказ может МС или руководитель производства',
  returnReason: 'Укажите причину возврата',
  launchingNow: 'Заказ сейчас запускает ',
  returnWait: ' — дождитесь итога или обновите карточку',
  checkWait: ' — подождите или попросите коллегу закрыть экран запуска, затем обновите карточку',
  erpExists: 'Заказ уже создан в производстве — сначала завершите запуск',
  launchRights: 'Запустить заказ может МС или руководитель производства',
  noLaunchCheck: 'Сначала проверка запуска',
  noPayment: 'Нет отметки оплаты',
  erpNotFound: 'Заказ ERP этого запуска не найден',
  erpNotThisLaunch: 'Заказ ERP с этой связью создан не этим запуском',
  finishRights: 'Завершить заказ может МС или руководитель производства',
  archiveRights: 'В архив черновик убирает автор или администратор',
  badTransition: 'Такой переход статуса недоступен',
  notWaiting: 'Заказ не ожидает запуска',
  erpRights: 'Нет прав производства на создание заказа и ТЗ — попросите администратора выдать должность в производстве (диспетчер, менеджер, начальник производства)',
  ownOrder: 'Свой заказ запускает другой МС или руководитель производства',
  ownOverride: 'Запуск без оплаты разрешили вы — запустить должен другой сотрудник',
  prevCancelled: 'Прежний заказ ERP отменён — удалите его в ERP, чтобы запустить заново',
  foreignErp: 'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства',
  orphanForeign: 'Заказ ERP с этой связью создан не этим запуском — обратитесь к администратору',
  badKind: 'Вид оплаты: prepaid или full',
  paymentRights: 'Оплату отмечает автор заказа или руководитель',
  paymentLate: 'Оплату отмечают до запуска',
  overrideLead: 'Запуск без оплаты разрешает только руководитель',
  msOwnPayment: 'Оплату своего заказа отмечает другой сотрудник',
  msNoErpPayment: 'Нет прав производства на отметку оплаты',
  msOnlyMark: 'Снять отметку или запустить без оплаты может только руководитель',
  staffRights: 'Отмечать сотрудников продаж может администратор, директор или РОП',
  staffArgs: 'Не указан профиль или признак',
  staffKind: 'Неизвестный признак: ожидается sales или ms',
  staffNotFound: 'Профиль не найден',
  staffSelf: 'Свой признак меняет администратор или директор',
  staffRopMs: 'Признак МС руководителю продаж ставит администратор или директор',
} as const;

/** Виды оплаты, которые J разрешает МС (`p_kind in ('prepaid', 'full')`) */
export const MS_PAYMENT_KINDS = ['prepaid', 'full'] as const;
/** Условия отправки J: PDF позиции в `orders/<id>/tz/`, тип, предел; макет у всех, кроме `other` */
export const SEND_RULES = { tzDir: '/tz/', pdfMime: 'application/pdf', pdfMaxBytes: 8388608, noArtworkMethod: 'other' } as const;
/** Окно чужой метки запуска и запрета возврата, минут */
export const LAUNCH_WINDOW_MINUTES = 10;

export type V4Caller = { id: string; name: string; role: string; is_sales?: boolean; is_ms?: boolean };

/** Настройки мока заказа v4 в `MockExtras.v4` */
export type V4MockOptions = {
  /** Кто зовёт RPC; по умолчанию dev-админ (как dev-автологин приложения) */
  caller?: V4Caller;
  /** Права ERP вызывающего (`erp_is_member`, `order.manage`, `tz.manage`); по умолчанию все есть */
  erp?: { member?: boolean; orderManage?: boolean; tzManage?: boolean };
  /** Свежая метка запуска другого МС */
  foreignLaunch?: { by: string; name: string };
  /** Кто разрешил запуск без оплаты (разделение обязанностей) */
  overrideBy?: string;
};

/** Доступ к строкам заказов `mockSupabase.ts` */
export type V4Ctx = {
  row: (id: string) => Record<string, unknown> | undefined;
  version: (id: string) => string | undefined;
  /** Новая версия строки (и поля в сохранённой строке, если она есть) */
  bump: (id: string, fields: Record<string, unknown>) => string;
  storage: () => Record<string, { type: string; body: Buffer }> | undefined;
};

type Extras = { v4?: V4MockOptions; launch?: { checks?: unknown[]; status?: string } };

const DEV: V4Caller = { id: 'dev', name: 'Dev Mode', role: 'admin', is_sales: false, is_ms: false };
const MOCK_LAUNCH_STARTED = '2026-10-17T10:00:00Z';
export const MOCK_ERP_ORDER = 'mock-erp-order-1';

type OrderSt = {
  status: string; created_by: string | null; paid_at: string | null; paid_kind: string | null;
  override: string | null; overrideBy: string | null; sent_at: string | null;
  launchAt: string | null; launchBy: string | null; erp: { id: string; by: string } | null; linked: string | null;
};
type Row = Record<string, unknown>;
type V4State = { orders: Map<string, OrderSt>; checks: number; erpCreates: Row[]; attachments: Row[]; events: Row[] };

const states = new WeakMap<object, V4State>();

/** Состояние мока v4 набора `MockExtras` — спеки читают записанные тела и события */
export function v4State(extra: object): V4State {
  let st = states.get(extra);
  if (!st) {
    st = { orders: new Map(), checks: 0, erpCreates: [], attachments: [], events: [] };
    states.set(extra, st);
  }
  return st;
}

function orderOf(extra: Extras, ctx: V4Ctx, id: string): OrderSt {
  const st = v4State(extra);
  let o = st.orders.get(id);
  if (!o) {
    const r = ctx.row(id);
    o = {
      status: extra.launch?.status ?? (r?.status as string | undefined) ?? 'ready_to_launch',
      created_by: (r?.created_by as string | null) ?? null,
      // Спека без строки заказа (прототип запуска) — оплата считается отмеченной
      paid_at: r ? (r.paid_at as string | null) ?? null : MOCK_LAUNCH_STARTED,
      paid_kind: r ? (r.paid_kind as string | null) ?? null : 'full',
      override: (r?.paid_override_reason as string | null) ?? null,
      overrideBy: extra.v4?.overrideBy ?? null,
      sent_at: (r?.sent_at as string | null) ?? null,
      launchAt: null, launchBy: null, erp: null,
      linked: (r?.erp_order_id as string | null) ?? null,
    };
    st.orders.set(id, o);
  }
  return o;
}

const callerOf = (extra: Extras) => extra.v4?.caller ?? DEV;
const isLead = (c: V4Caller) => ['admin', 'director', 'rop'].includes(c.role);
const isBoss = (c: V4Caller) => ['admin', 'director'].includes(c.role);
const isAuthor = (c: V4Caller, o: OrderSt) => !!c.is_sales && o.created_by === c.id;
const erpOk = (extra: Extras, k: 'member' | 'orderManage' | 'tzManage') => extra.v4?.erp?.[k] !== false;
const fail = (msg: string, code = 'P0001') => new RpcFailure(code, msg);

function visible(c: V4Caller, o: OrderSt): boolean {
  return isLead(c) || isAuthor(c, o) || (!!c.is_ms && ['ready_to_launch', 'production', 'done'].includes(o.status));
}

/** Условия отправки J по строке заказа (если спека её дала) */
function sendFailure(id: string, ctx: V4Ctx): RpcFailure | null {
  const r = ctx.row(id);
  if (!r) return null;
  if (!String(r.customer ?? '').trim()) return fail(J_TEXTS.noCustomer);
  if (!r.due_date) return fail(J_TEXTS.noDue);
  const items = (r.order_items ?? []) as Row[];
  if (items.length === 0) return fail(J_TEXTS.noItems);
  const objects = ctx.storage();
  const has = (path: string, ok: (type: string, size: number) => boolean) => {
    if (!objects) return true;
    const o = objects[`order-artworks/${path}`];
    return !!o && ok(o.type, o.body.length);
  };
  for (const it of items) {
    const p = String(it.tz_pdf_path ?? '');
    if (!p.startsWith(`orders/${id}${SEND_RULES.tzDir}`) || p.includes('..')
      || !has(p, (t, s) => t === SEND_RULES.pdfMime && s <= SEND_RULES.pdfMaxBytes)) return fail(J_TEXTS.noTzPdf);
  }
  for (const it of items) {
    for (const pr of (it.order_item_prints ?? []) as Row[]) {
      if (pr.method === SEND_RULES.noArtworkMethod) continue;
      const a = String(pr.artwork_path ?? '');
      if (!a || !has(a, (t) => t !== '')) return fail(J_TEXTS.noArtwork);
    }
  }
  return null;
}

function event(extra: Extras, row: Row): void {
  v4State(extra).events.push({ id: v4State(extra).events.length + 1, at: MOCK_LAUNCH_STARTED, ...row });
}

function transition(body: Row, extra: Extras, ctx: V4Ctx): unknown {
  const c = callerOf(extra);
  const id = String(body.p_id ?? '');
  const to = String(body.p_to ?? '');
  const reason = String(body.p_reason ?? '').trim() || null;
  if (!['ready_to_launch', 'draft', 'production', 'done', 'archived'].includes(to)) return fail(J_TEXTS.unknownStatus, '22023');
  if (String(body.p_reason ?? '').length > 500) return fail(J_TEXTS.reasonLong, '22023');
  const o = orderOf(extra, ctx, id);
  if (!visible(c, o)) return fail(J_TEXTS.hidden, '42501');
  const launcher = !!c.is_ms || isBoss(c);
  const answer = (updated_at: string) => ({ id, status: o.status, erp_order_id: o.linked, updated_at, sent_at: o.sent_at });
  if (to === 'production' && o.status === 'production' && launcher) return answer(ctx.version(id) ?? MOCK_LAUNCH_STARTED);
  const from = o.status;
  if (o.status === 'draft' && to === 'ready_to_launch') {
    const expected = body.p_expected_updated_at;
    if (expected && expected !== ctx.version(id)) return fail(J_TEXTS.conflict);
    if (!(isAuthor(c, o) || isLead(c))) return fail(J_TEXTS.sendRights, '42501');
    const bad = sendFailure(id, ctx);
    if (bad) return bad;
    o.status = to;
    o.sent_at = MOCK_LAUNCH_STARTED;
  } else if (o.status === 'ready_to_launch' && to === 'draft') {
    if (!launcher) return fail(J_TEXTS.returnRights, '42501');
    if (!reason) return fail(J_TEXTS.returnReason);
    const foreign = extra.v4?.foreignLaunch;
    if (foreign && foreign.by !== c.id) return fail(`${J_TEXTS.launchingNow}${foreign.name}${J_TEXTS.returnWait}`);
    if (o.erp) return fail(J_TEXTS.erpExists);
    Object.assign(o, { status: to, launchAt: null, launchBy: null });
  } else if (o.status === 'ready_to_launch' && to === 'production') {
    if (!launcher) return fail(J_TEXTS.launchRights, '42501');
    if (!o.launchAt) return fail(J_TEXTS.noLaunchCheck);
    if (!o.paid_at && !o.override) return fail(J_TEXTS.noPayment);
    if (!o.erp) return fail(J_TEXTS.erpNotFound);
    if (body.p_erp_order_id !== o.erp.id || o.erp.by !== o.launchBy) return fail(J_TEXTS.erpNotThisLaunch);
    Object.assign(o, { status: to, linked: o.erp.id });
  } else if (o.status === 'production' && to === 'done') {
    if (!launcher) return fail(J_TEXTS.finishRights, '42501');
    o.status = to;
  } else if (o.status === 'draft' && to === 'archived') {
    if (!(isAuthor(c, o) || c.role === 'admin')) return fail(J_TEXTS.archiveRights, '42501');
    o.status = to;
  } else {
    return fail(J_TEXTS.badTransition);
  }
  event(extra, { order_id: id, kind: 'status', from_status: from, to_status: to, reason, actor: c.id });
  return answer(ctx.bump(id, { status: o.status, sent_at: o.sent_at, erp_order_id: o.linked }));
}

function launchCheck(body: Row, extra: Extras, ctx: V4Ctx): unknown {
  const st = v4State(extra);
  const n = st.checks++;
  const custom = extra.launch?.checks;
  if (custom && custom.length > 0) {
    const a = custom[Math.min(n, custom.length - 1)] as Row;
    return a.ok ? { launched: false, ...a } : a;
  }
  const c = callerOf(extra);
  const id = String(body.p_id ?? '');
  const o = orderOf(extra, ctx, id);
  if (!visible(c, o)) return fail(J_TEXTS.hidden, '42501');
  if (!(c.is_ms || isBoss(c))) return fail(J_TEXTS.launchRights, '42501');
  const v = () => ctx.version(id) ?? MOCK_LAUNCH_STARTED;
  const no = (reason: string) => ({ ok: false, reason, launched: !!o.linked, updated_at: v() });
  if (o.linked || o.status === 'production' || o.status === 'done') {
    return { ok: true, already: true, launched: true, erp_order_id: o.linked ?? MOCK_ERP_ORDER, updated_at: v() };
  }
  if (!(erpOk(extra, 'member') && erpOk(extra, 'orderManage') && erpOk(extra, 'tzManage'))) return no(J_TEXTS.erpRights);
  if (o.created_by === c.id && !isBoss(c)) return no(J_TEXTS.ownOrder);
  if (o.status !== 'ready_to_launch') return no(J_TEXTS.notWaiting);
  if (!o.paid_at && !o.override) return no(J_TEXTS.noPayment);
  if (!o.paid_kind && o.override && o.overrideBy === c.id) return no(J_TEXTS.ownOverride);
  const foreign = extra.v4?.foreignLaunch;
  if (foreign && foreign.by !== c.id && !o.erp) return no(`${J_TEXTS.launchingNow}${foreign.name}${J_TEXTS.checkWait}`);
  if (o.erp) {
    // Сирота этого запуска: заказ ERP создан тем, кто ставил метку
    if (o.launchAt && o.erp.by === o.launchBy) {
      return { ok: true, already: true, launched: false, erp_order_id: o.erp.id, launch_started_at: o.launchAt, updated_at: v() };
    }
    return no(J_TEXTS.orphanForeign);
  }
  Object.assign(o, { launchAt: MOCK_LAUNCH_STARTED, launchBy: c.id });
  return { ok: true, already: false, launched: false, launch_started_at: o.launchAt, updated_at: ctx.bump(id, {}) };
}

function setPayment(body: Row, extra: Extras, ctx: V4Ctx): unknown {
  const c = callerOf(extra);
  const id = String(body.p_id ?? '');
  const kind = (body.p_kind ?? null) as string | null;
  const reason = String(body.p_override_reason ?? '').trim() || null;
  if (kind !== null && !(MS_PAYMENT_KINDS as readonly string[]).includes(kind)) return fail(J_TEXTS.badKind, '22023');
  if (String(body.p_override_reason ?? '').length > 500) return fail(J_TEXTS.reasonLong, '22023');
  const o = orderOf(extra, ctx, id);
  if (!visible(c, o)) return fail(J_TEXTS.hidden, '42501');
  const lead = isLead(c);
  if (!lead && !isAuthor(c, o)) {
    if (!c.is_ms) return fail(J_TEXTS.paymentRights, '42501');
    if (!(o.status === 'ready_to_launch' && kind !== null && !reason)) return fail(J_TEXTS.msOnlyMark, '42501');
    if (o.created_by === c.id) return fail(J_TEXTS.msOwnPayment, '42501');
    if (!erpOk(extra, 'orderManage')) return fail(J_TEXTS.msNoErpPayment, '42501');
  }
  if (!['draft', 'ready_to_launch'].includes(o.status)) return fail(J_TEXTS.paymentLate);
  if (reason && !lead) return fail(J_TEXTS.overrideLead, '42501');
  o.paid_at = kind ? MOCK_LAUNCH_STARTED : null;
  o.paid_kind = kind;
  if (reason) Object.assign(o, { override: reason, overrideBy: c.id });
  else if (kind === null && lead) Object.assign(o, { override: null, overrideBy: null });
  event(extra, { order_id: id, kind: 'payment', payment_kind: kind, reason, actor: c.id });
  const updated_at = ctx.bump(id, { paid_at: o.paid_at, paid_kind: o.paid_kind, paid_override_reason: o.override });
  return { id, paid_at: o.paid_at, paid_kind: o.paid_kind, paid_override_reason: o.override, updated_at, status: o.status };
}

/**
 * `erp_create_order`: тело записывается (`v4State(extra).erpCreates`), вложения
 * нанесений и бирок — строками `erp_order_attachments`. Ключ `print_key`/
 * `label_key` переводится в номер по позиции payload, неизвестный ключ
 * выбрасывается — как стор ERP. Ответ — голая строка id (как у RPC).
 */
function erpCreate(body: Row, extra: Extras, ctx: V4Ctx): unknown {
  const st = v4State(extra);
  const payload = (body.payload ?? {}) as Row;
  st.erpCreates.push(payload);
  const items = (payload.items ?? []) as Row[];
  const indexOf = (a: Row, list: 'prints' | 'labels', key: unknown) =>
    ((items[Number(a.item_index)]?.[list] ?? []) as Row[]).findIndex((x) => x.key === key);
  for (const a of (payload.attachments ?? []) as Row[]) {
    const { print_key: pk, label_key: lk, ...rest } = a;
    const row: Row = { ...rest, order_id: MOCK_ERP_ORDER };
    if (pk !== undefined) row.print_index = indexOf(a, 'prints', pk);
    if (lk !== undefined) row.label_index = indexOf(a, 'labels', lk);
    if (row.print_index === -1 || row.label_index === -1) continue;
    st.attachments.push(row);
  }
  // Связь — по `tz_order_id` payload; без неё (старые спеки) — единственный заказ состояния
  const tzId = String(payload.tz_order_id ?? '') || (st.orders.size === 1 ? [...st.orders.keys()][0] : '');
  if (tzId) orderOf(extra, ctx, tzId).erp = { id: MOCK_ERP_ORDER, by: callerOf(extra).id };
  return MOCK_ERP_ORDER;
}

function setStaff(body: Row, extra: Extras & { salesStaff?: Row[] }): unknown {
  // Миграция H: перегрузки (p_profile, p_on) нет — PostgREST не находит функцию
  if (!('p_kind' in body)) {
    return new RpcFailure('PGRST202', 'Could not find the function public.sales_set_staff(p_on, p_profile) in the schema cache', 404);
  }
  const c = callerOf(extra);
  if (!isLead(c)) return fail(J_TEXTS.staffRights, '42501');
  if (!body.p_profile || body.p_on === undefined || body.p_on === null) return fail(J_TEXTS.staffArgs, '22023');
  if (body.p_profile === c.id && !isBoss(c)) return fail(J_TEXTS.staffSelf, '42501');
  const kind = body.p_kind;
  if (kind !== 'sales' && kind !== 'ms') return fail(J_TEXTS.staffKind, '22023');
  const row = (extra.salesStaff ?? []).find((r) => r.id === body.p_profile);
  if (kind === 'ms' && body.p_on && row?.role === 'rop' && !isBoss(c)) return fail(J_TEXTS.staffRopMs, '42501');
  if (!row) return extra.salesStaff ? fail(J_TEXTS.staffNotFound, 'P0002') : null;
  row[kind === 'ms' ? 'is_ms' : 'is_sales'] = Boolean(body.p_on);
  return null;
}

const HANDLED = ['order_v4_transition', 'order_v4_launch_check', 'order_v4_set_payment', 'erp_create_order', 'sales_set_staff'];

/** Ответ RPC v4 либо `undefined` — функция не этого модуля */
export function v4Rpc(fn: string, body: Row, extra: Extras & { salesStaff?: Row[] }, ctx: V4Ctx): unknown {
  if (!HANDLED.includes(fn)) return undefined;
  if (fn === 'order_v4_transition') return transition(body, extra, ctx);
  if (fn === 'order_v4_launch_check') return launchCheck(body, extra, ctx);
  if (fn === 'order_v4_set_payment') return setPayment(body, extra, ctx);
  if (fn === 'erp_create_order') return erpCreate(body, extra, ctx);
  return setStaff(body, extra);
}

/** Таблицы журнала v4 (`order_events`, `erp_order_attachments`) либо `undefined` */
export function v4Table(table: string, params: URLSearchParams, extra: object): unknown[] | undefined {
  const st = v4State(extra);
  const eq = (k: string) => params.get(k)?.replace(/^eq\./, '');
  if (table === 'order_events') {
    const id = eq('order_id');
    return st.events
      .filter((e) => (!id || e.order_id === id) && (!eq('kind') || e.kind === eq('kind'))
        && (!eq('from_status') || e.from_status === eq('from_status')) && (!eq('to_status') || e.to_status === eq('to_status'))
        && (params.get('reason') !== 'not.is.null' || e.reason !== null))
      .reverse();
  }
  if (table === 'erp_order_attachments') {
    const id = eq('order_id');
    const kinds = /^in\.\((.*)\)$/.exec(params.get('kind') ?? '')?.[1]?.split(',');
    return st.attachments.filter((a) => (!id || a.order_id === id) && (!kinds || kinds.includes(String(a.kind))));
  }
  return undefined;
}
