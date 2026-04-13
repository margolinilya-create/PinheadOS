// redesign/v2 — /tech-cards index

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { translateSupabaseError } from '../../../utils/i18n';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { Skeleton } from '../../shared/Skeleton';
import s from './v2.module.css';

const TC_STATUS_LABEL = {
  draft: 'Черновик',
  approved: 'Утверждена',
  locked: 'Заблокирована',
};

const TC_STATUS_CLASS = {
  draft: s.badgeDraft,
  approved: s.badgeApproved,
  locked: s.badgeLocked,
};

export default function TechCardOrderList() {
  useDocumentTitle('Tech Cards');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, order_tech_cards(id, status)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        toast.error(translateSupabaseError(error.message));
        setLoading(false);
        return;
      }
      setOrders(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.trim().toLowerCase();
    return orders.filter((o) =>
      (o.order_number ?? '').toLowerCase().includes(q)
      || (o.status ?? '').toLowerCase().includes(q)
    );
  }, [orders, search]);

  return (
    <div className={s.page}>
      <h1>Tech Cards</h1>
      <p className={s.subtitle}>
        Список заказов. Кликните, чтобы открыть или создать технологическую карту.
      </p>

      {orders.length > 0 && (
        <div className={s.formRow}>
          <input
            type="search"
            placeholder="Поиск по номеру или статусу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={s.searchInput}
          />
          <span className={s.spacer} />
          <span className={s.subtitle} style={{ margin: 0 }}>
            {filtered.length} из {orders.length}
          </span>
        </div>
      )}

      {loading ? (
        <div className={s.skeletonRow}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : orders.length === 0 ? (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>📋</span>
          <div className={s.emptyStateTitle}>Заказов пока нет</div>
          <p>Создайте первый заказ через <Link to="/">визард</Link>.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>🔍</span>
          <div className={s.emptyStateTitle}>Ничего не найдено</div>
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>№ заказа</th>
              <th>Статус заказа</th>
              <th>Tech card</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const tc = o.order_tech_cards?.[0];
              return (
                <tr key={o.id}>
                  <td><strong>{o.order_number}</strong></td>
                  <td>{o.status}</td>
                  <td>
                    {tc ? (
                      <span className={`${s.badge} ${TC_STATUS_CLASS[tc.status] ?? ''}`}>
                        {TC_STATUS_LABEL[tc.status] ?? tc.status}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>не создана</span>
                    )}
                  </td>
                  <td className={s.numCol}>
                    <Link className="btn btn-primary" to={`/tech-cards/${o.id}`}>
                      {tc ? 'Открыть' : 'Создать'}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
