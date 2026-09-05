/**
 * Группировка уведомлений обзора по критичности.
 *
 * Было: плоский список одинаковых строк «Просрочен заказ №…», обрезанный
 * до шести штук. На боевых данных 03.08.2026 просрочены 47 активных заказов
 * из 76 — то есть виджет показывал шесть случайных из сорока семи и молчал
 * о том, что их сорок семь. Ни приоритета, ни действия, ни объёма.
 *
 * Стало: группы по тому, ЧТО ДЕЛАТЬ. Порядок групп — порядок срочности,
 * и первая всегда развёрнута: «горит сейчас» не должно требовать клика.
 * Давняя просрочка свёрнута со счётчиком — она важна, но это не сегодняшняя
 * работа, и раскрытой она вытесняла бы срочное за экран.
 *
 * Чистая функция: экран только рисует результат.
 */

import { hasOpenProcurement } from './routes';

import { overdueBucket } from './format';

export type NoticeKind = 'blocked' | 'overdue' | 'procurement';

export interface Notice {
  id: string;
  orderId: string;
  kind: NoticeKind;
  /** Заголовок строки: «Просрочен заказ №1042» */
  text: string;
  /** Пояснение: название заказа */
  sub: string;
  /** Дней просрочки — только для kind='overdue' */
  overdueDays?: number;
}

export interface NoticeGroup {
  key: string;
  title: string;
  /** Что делать с этой группой — текстом, а не только цветом */
  hint: string;
  tone: 'danger' | 'warn' | 'neutral';
  icon: string;
  items: Notice[];
  /** Развёрнута ли по умолчанию */
  open: boolean;
}

/** Описание групп в порядке срочности; пустые в результат не попадают */
const GROUPS: Array<Omit<NoticeGroup, 'items'> & { match: (n: Notice) => boolean }> = [
  {
    key: 'blocked',
    title: 'Остановлено',
    hint: 'Цех не может продолжать — нужно решение',
    tone: 'danger',
    icon: 'ban',
    open: true,
    match: (n) => n.kind === 'blocked',
  },
  {
    key: 'overdue-week',
    title: 'Горит: просрочка до недели',
    hint: 'Ещё можно вытянуть — разберите сегодня',
    tone: 'danger',
    icon: 'alert',
    open: true,
    match: (n) => n.kind === 'overdue' && overdueBucket(n.overdueDays ?? 0) === 'week',
  },
  {
    key: 'procurement',
    title: 'Дозакупка',
    hint: 'Материал не закрыт — этап встанет',
    tone: 'warn',
    icon: 'truck',
    open: true,
    match: (n) => n.kind === 'procurement',
  },
  {
    key: 'overdue-month',
    title: 'Просрочены 8–30 дней',
    hint: 'Требуют пересмотра срока с клиентом, а не ускорения',
    tone: 'warn',
    icon: 'clock',
    open: false,
    match: (n) => n.kind === 'overdue' && overdueBucket(n.overdueDays ?? 0) === 'month',
  },
  {
    key: 'overdue-stale',
    title: 'Просрочены больше месяца',
    hint: 'Скорее всего заброшены: закройте или пометьте тестовыми',
    tone: 'neutral',
    icon: 'archive',
    open: false,
    match: (n) => n.kind === 'overdue' && overdueBucket(n.overdueDays ?? 0) === 'stale',
  },
];

/**
 * Разложить уведомления по группам. Внутри группы просрочка сортируется
 * по величине — самый давний сверху, потому что решение по нему дороже всего
 * откладывать. Порядок групп фиксирован описанием, а не данными.
 */
/**
 * Уведомления по ОДНОМУ заказу — единственное место, где решается, что считать
 * поводом вмешаться.
 *
 * ЗАЧЕМ ВЫНЕСЕНО. Список строился прямо в «Обзоре», а колокол в шапке считал
 * СВОЮ величину — просроченные по `planned_end` этапы (`overdueUnackCountFor`).
 * Плановая дата ставится только при взятии в работу, поэтому на проде она была
 * у 16 этапов из 311: единственный глобальный индикатор «что горит» считал
 * почти всегда ноль и вёл при этом на виджет, сгруппированный совсем по другому.
 * На снимке обзора это видно прямо: KPI «Просрочено 1», колокол пуст.
 *
 * `lateDays` приходит параметром, а не считается здесь: у вызывающих он уже
 * есть, а модуль не должен зависеть от «сегодня» (то же правило, что
 * у `isOrderOverdue`).
 */
export function orderNotices(order: NoticeOrder, lateDays: number): Notice[] {
  const out: Notice[] = [];
  const num = order.bitrix_id || '—';
  if (hasOpenProcurement(order.procurement_tasks)) {
    out.push({
      id: `p-${order.id}`, orderId: order.id, kind: 'procurement',
      text: `Дозакупка по заказу №${num}`, sub: order.title ?? '',
    });
  }
  if (lateDays > 0) {
    out.push({
      id: `o-${order.id}`, orderId: order.id, kind: 'overdue',
      text: `Просрочен заказ №${num}`, sub: order.title ?? '', overdueDays: lateDays,
    });
  }
  // Остановленный этап — единственное, что нельзя «подождать»: цех стоит
  if ((order.items ?? []).some((it) => (it.stages ?? []).some((st) => st.status === 'blocked'))) {
    out.push({
      id: `b-${order.id}`, orderId: order.id, kind: 'blocked',
      text: `Остановлен этап по заказу №${num}`, sub: order.title ?? '',
    });
  }
  return out;
}

/** Минимум заказа, из которого строятся уведомления */
export interface NoticeOrder {
  id: string;
  title?: string | null;
  bitrix_id?: string | null;
  procurement_tasks?: { source_stage_id: string | null; status: string }[] | null;
  items?: { stages?: { status: string }[] }[] | null;
}

export function groupNotices(notices: Notice[]): NoticeGroup[] {
  const out: NoticeGroup[] = [];
  for (const g of GROUPS) {
    const items = notices.filter(g.match);
    if (items.length === 0) continue;
    if (g.key.startsWith('overdue')) {
      items.sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));
    }
    const { match, ...rest } = g;
    void match;
    out.push({ ...rest, items });
  }
  return out;
}

/** Сколько всего уведомлений — для заголовка виджета и колокола */
export function noticeCount(groups: NoticeGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}

/**
 * Сколько требует действия ПРЯМО СЕЙЧАС — сумма развёрнутых по умолчанию групп.
 * Именно это число осмысленно вынести в шапку: «47» не отвечало ни на что.
 */
export function urgentCount(groups: NoticeGroup[]): number {
  return groups.filter((g) => g.open).reduce((n, g) => n + g.items.length, 0);
}
