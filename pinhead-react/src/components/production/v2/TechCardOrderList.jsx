// redesign/v2 — /tech-cards index
//
// Lists orders with their tech card status. Minimal: just order_number,
// order status, and tech card status. Click through to the builder.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { translateSupabaseError } from '../../../utils/i18n';

const TC_STATUS_LABEL = {
  draft: 'Черновик',
  approved: 'Утверждена',
  locked: 'Заблокирована',
};

export default function TechCardOrderList() {
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
    <div className="container" style={{ maxWidth: 900 }}>
      <h1>Tech Cards</h1>
      <p style={{ opacity: 0.7 }}>
        Список заказов. Кликните, чтобы открыть или создать технологическую карту.
      </p>

      {orders.length === 0 ? (
        <div className="panel">
          <p>Нет заказов. Создайте один через <Link to="/">визард</Link>.</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
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
                <tr key={o.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <td><strong>{o.order_number}</strong></td>
                  <td>{o.status}</td>
                  <td>
                    {tc ? (
                      <span>{TC_STATUS_LABEL[tc.status] ?? tc.status}</span>
                    ) : (
                      <span style={{ opacity: 0.5 }}>не создана</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
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
