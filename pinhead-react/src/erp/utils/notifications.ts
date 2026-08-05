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
