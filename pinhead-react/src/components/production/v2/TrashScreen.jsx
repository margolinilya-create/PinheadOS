// redesign/v2 — Trash recovery screen
//
// Lists soft-deleted order_tech_operations across all orders. Restore
// flips deleted_at = NULL. Permanent purge happens via DB cron later
// (out of scope for MVP — soft-deleted rows just accumulate for now).
//
// Restricted to admin/director (HR-equivalent destructive recovery).

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { translateSupabaseError } from '../../../utils/i18n';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import s from './v2.module.css';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', { hour12: false });
  } catch {
    return iso;
  }
}

export default function TrashScreen() {
  useDocumentTitle('Корзина');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('order_tech_operations')
      .select('id, name_snapshot, qty, rate_snapshot, unit_snapshot, order_id, deleted_at, orders(order_number)')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(200);

    if (error) {
      toast.error(translateSupabaseError(error.message));
      setLoading(false);
      return;
    }
    setItems(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (!alive) return;
    })();
    return () => { alive = false; };
  }, [load]);

  const handleRestore = async (item) => {
    setRestoring(item.id);
    const { error } = await supabase
      .from('order_tech_operations')
      .update({ deleted_at: null })
      .eq('id', item.id);

    setRestoring(null);
    if (error) {
      toast.error(translateSupabaseError(error.message));
      return;
    }
    toast.success?.('Восстановлено') ?? null;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  return (
    <div className={s.page}>
      <h1>Корзина</h1>
      <p className={s.subtitle}>
        Soft-deleted операции tech card. Восстановление возвращает строку в активную карту.
        Полная очистка — через DB cron (out of scope MVP).
      </p>

      {loading && <div className="panel-loading">Загрузка…</div>}

      {!loading && items.length === 0 && (
        <p className={s.empty}>Корзина пуста.</p>
      )}

      {!loading && items.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th>Операция</th>
              <th>Заказ</th>
              <th className={s.numCol}>Кол-во</th>
              <th className={s.numCol}>Тариф</th>
              <th>Удалено</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name_snapshot}</td>
                <td>
                  <Link to={`/tech-cards/${item.order_id}`}>
                    {item.orders?.order_number ?? item.order_id.slice(0, 8)}
                  </Link>
                </td>
                <td className={s.numCol}>{item.qty} {item.unit_snapshot}</td>
                <td className={s.numCol}>{item.rate_snapshot}₽</td>
                <td>{formatDate(item.deleted_at)}</td>
                <td className={s.numCol}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleRestore(item)}
                    disabled={restoring === item.id}
                  >
                    Восстановить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
