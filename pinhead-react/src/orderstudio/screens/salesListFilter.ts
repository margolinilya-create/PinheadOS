/** Фильтры списка заказов v4: поиск по клиенту и номеру, статус, «Мои / Все» */
import type { SalesOrderListRow } from '../api/salesOrders';

export interface SalesListFilter {
  query: string;
  /** Пусто — любой статус */
  status: string;
  /** Только заказы, заведённые мной (у руководства) */
  mine: boolean;
}

export const EMPTY_FILTER: SalesListFilter = { query: '', status: '', mine: false };

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

export function filterSalesList(rows: SalesOrderListRow[], f: SalesListFilter, uid: string | null): SalesOrderListRow[] {
  return rows.filter((r) => (!f.status || r.status === f.status)
    && (!f.mine || (uid !== null && r.created_by === uid))
    && matches(r, f.query));
}

export const isFiltered = (f: SalesListFilter): boolean => !!(f.query.trim() || f.status || f.mine);
