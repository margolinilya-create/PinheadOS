// redesign/v2 — Orders table view (alternative to /orders Kanban)
//
// Reads useOrdersStore (same source as KanbanBoard), renders as flat
// table with sortable columns + status filter + search. Live updates
// via the same store, so Kanban and table stay in sync.
//
// Reuses STATUS_LIST/LABELS exported from useOrdersStore. Does NOT
// touch KanbanBoard.jsx (red zone for main → v2 merges).

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useOrdersStore,
  STATUS_LIST,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../../../store/useOrdersStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { Skeleton } from '../../shared/Skeleton';
import s from './v2.module.css';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ru-RU');
  } catch {
    return iso;
  }
}

export default function OrdersTableView() {
  useDocumentTitle('Заказы — таблица');
  const orders = useOrdersStore((st) => st.orders);
  const loading = useOrdersStore((st) => st.loading);
  const fetchOrders = useOrdersStore((st) => st.fetchOrders);

  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    if (orders.length === 0) fetchOrders();
  }, [orders.length, fetchOrders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== 'all') list = list.filter((o) => o.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((o) =>
        (o.order_number ?? '').toLowerCase().includes(q)
        || (o.bitrix_deal ?? '').toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      const va = a[sortBy] ?? '';
      const vb = b[sortBy] ?? '';
      if (va === vb) return 0;
      const cmp = va > vb ? 1 : -1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [orders, statusFilter, search, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const headerSort = (col) => sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className={s.pageWide}>
      <div className={s.header}>
        <h1>Заказы — таблица</h1>
        <Link to="/orders" className="btn btn-ghost">→ Канбан</Link>
      </div>
      <p className={s.subtitle}>
        Альтернативный листинг заказов. Та же data-source что и Канбан, изменения видны в обоих.
      </p>

      <div className={s.formRow}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Все статусы</option>
          {STATUS_LIST.map((st) => (
            <option key={st} value={st}>{STATUS_LABELS[st]}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Поиск по номеру или Bitrix deal"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={s.searchInput}
        />
        <span className={s.spacer} />
        <span className={s.subtitle} style={{ margin: 0 }}>
          {filtered.length} из {orders.length}
        </span>
      </div>

      {loading && orders.length === 0 && (
        <div className={s.skeletonRow}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>🔍</span>
          <div className={s.emptyStateTitle}>Ничего не найдено</div>
          <p>Попробуйте изменить статус-фильтр или поиск.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th onClick={() => toggleSort('order_number')} className={s.sortable}>
                № заказа{headerSort('order_number')}
              </th>
              <th onClick={() => toggleSort('status')} className={s.sortable}>
                Статус{headerSort('status')}
              </th>
              <th>Bitrix deal</th>
              <th className={`${s.numCol} ${s.sortable}`} onClick={() => toggleSort('total_qty')}>
                Кол-во{headerSort('total_qty')}
              </th>
              <th className={`${s.numCol} ${s.sortable}`} onClick={() => toggleSort('total_sum')}>
                Сумма{headerSort('total_sum')}
              </th>
              <th onClick={() => toggleSort('created_at')} className={s.sortable}>
                Создан{headerSort('created_at')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const colors = STATUS_COLORS[o.status] ?? {};
              return (
                <tr key={o.id}>
                  <td>
                    <Link to={`/tech-cards/${o.id}`} style={{ fontWeight: 600 }}>
                      {o.order_number}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={s.badge}
                      style={{ background: colors.bg, color: colors.text }}
                    >
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td>{o.bitrix_deal ?? '—'}</td>
                  <td className={s.numCol}>{o.total_qty ?? 0}</td>
                  <td className={s.numCol}>{(o.total_sum ?? 0).toLocaleString('ru-RU')}₽</td>
                  <td>{formatDate(o.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
