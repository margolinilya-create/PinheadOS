// redesign/v2 — /tech-cards index

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { translateSupabaseError } from '../../../utils/i18n';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
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

  if (loading) return <div className="panel-loading">Загрузка…</div>;

  return (
    <div className={s.page}>
      <h1>Tech Cards</h1>
      <p className={s.subtitle}>
        Список заказов. Кликните, чтобы открыть или создать технологическую карту.
      </p>

      {orders.length === 0 ? (
        <div className={s.card}>
          <p>Нет заказов. Создайте один через <Link to="/">визард</Link>.</p>
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
            {orders.map((o) => {
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
                      <span className={s.empty} style={{ padding: 0 }}>не создана</span>
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
