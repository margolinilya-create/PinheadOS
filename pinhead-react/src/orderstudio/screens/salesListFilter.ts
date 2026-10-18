/**
 * Фильтры списка заказов v4: поиск по клиенту и номеру, статус, «Мои / Все»,
 * сортировка. Всё живёт в адресе (`?q=&status=&mine=1&sort=due`): пресет
 * «К запуску» (веха 6+7, К22) — ссылка `/sales?status=ready_to_launch&sort=due`.
 */
import type { SalesOrderListRow } from '../api/salesOrders';
import type { SalesOrderStatus } from '../model/types';

/** `updated` — сначала недавно изменённые (как отдаёт база); `due` — по сроку, без срока в конце */
export type SalesListSort = 'due' | 'updated';

export interface SalesListFilter {
  query: string;
  /** Пусто — любой статус */
  status: string;
  /** Только заказы, заведённые мной (у руководства) */
  mine: boolean;
  /** Порядок строк; нет — `updated` */
  sort?: SalesListSort;
}

export const EMPTY_FILTER: SalesListFilter = { query: '', status: '', mine: false, sort: 'updated' };

/** Статусы, которые можно выбрать адресом; прочее значение — «любой» */
const STATUSES: readonly SalesOrderStatus[] = [
  'draft', 'price_review', 'quoted', 'ready_to_launch', 'production', 'done', 'cancel_requested', 'archived',
];

/** Фильтр из адреса. «Мои» — только у руководства (у продавца список и так свой) */
export function filterFromParams(params: URLSearchParams, lead: boolean): SalesListFilter {
  const status = params.get('status') ?? '';
  return {
    query: params.get('q') ?? '',
    status: (STATUSES as readonly string[]).includes(status) ? status : '',
    mine: lead && params.get('mine') === '1',
    sort: params.get('sort') === 'due' ? 'due' : 'updated',
  };
}

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();

/** Номер без префикса и ведущих нулей: «PH-0102», «0102» и «102» находят одно */
const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');

function matches(row: SalesOrderListRow, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  if (norm(row.customer).includes(q) || norm(row.order_number).includes(q)) return true;
  const qd = digits(q);
  return qd !== '' && digits(row.order_number ?? '').includes(qd);
}

/** Сравнение строк ISO */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Новая копия в порядке `sort`; при равном сроке — недавно изменённые выше */
export function sortSalesList(rows: SalesOrderListRow[], sort: SalesListSort): SalesOrderListRow[] {
  const byUpdated = (a: SalesOrderListRow, b: SalesOrderListRow) => cmp(b.updated_at ?? '', a.updated_at ?? '');
  if (sort === 'updated') return [...rows].sort(byUpdated);
  return [...rows].sort((a, b) => {
    const da = a.due_date ?? '';
    const db = b.due_date ?? '';
    if (!da !== !db) return da ? -1 : 1;
    return cmp(da, db) || byUpdated(a, b);
  });
}

export function filterSalesList(rows: SalesOrderListRow[], f: SalesListFilter, uid: string | null): SalesOrderListRow[] {
  const hit = rows.filter((r) => (!f.status || r.status === f.status)
    && (!f.mine || (uid !== null && r.created_by === uid))
    && matches(r, f.query));
  return f.sort === 'due' ? sortSalesList(hit, 'due') : hit;
}

/** Сортировка фильтром не считается: «Сбросить фильтры» её не требует */
export const isFiltered = (f: SalesListFilter): boolean => !!(f.query.trim() || f.status || f.mine);
