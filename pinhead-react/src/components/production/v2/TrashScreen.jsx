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
import { Skeleton } from '../../shared/Skeleton';
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
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [opsRes, cardsRes] = await Promise.all([
      supabase
        .from('order_tech_operations')
        .select('id, name_snapshot, qty, rate_snapshot, unit_snapshot, order_id, deleted_at, orders(order_number)')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .limit(200),
      supabase
        .from('order_tech_cards')
        .select('id, status, order_id, deleted_at, orders(order_number)')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .limit(200),
    ]);

    if (opsRes.error) {
      toast.error(translateSupabaseError(opsRes.error.message));
    } else {
      setItems(opsRes.data ?? []);
    }
    if (cardsRes.error) {
      toast.error(translateSupabaseError(cardsRes.error.message));
    } else {
      setCards(cardsRes.data ?? []);
    }
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

  const handleRestoreCard = async (card) => {
    setRestoring(card.id);
    const { error } = await supabase
      .from('order_tech_cards')
      .update({ deleted_at: null })
      .eq('id', card.id);

    setRestoring(null);
    if (error) {
      toast.error(translateSupabaseError(error.message));
      return;
    }
    toast.success?.('Tech card восстановлена') ?? null;
    setCards((prev) => prev.filter((c) => c.id !== card.id));
  };

  return (
    <div className={s.page}>
      <h1>Корзина</h1>
      <p className={s.subtitle}>
        Soft-deleted операции tech card. Восстановление возвращает строку в активную карту.
        Полная очистка — через DB cron (out of scope MVP).
      </p>

      {loading && (
        <div className={s.skeletonRow}>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      )}

      {!loading && items.length === 0 && cards.length === 0 && (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>🗑️</span>
          <div className={s.emptyStateTitle}>Корзина пуста</div>
          <p>Удалённые операции и tech cards появятся здесь после истечения 5-секундного undo.</p>
        </div>
      )}

      {!loading && cards.length > 0 && (
        <section className={s.section}>
          <h2>Tech cards ({cards.length})</h2>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Заказ</th>
                <th>Статус</th>
                <th>Удалено</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/tech-cards/${c.order_id}`}>
                      {c.orders?.order_number ?? c.order_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{c.status}</td>
                  <td>{formatDate(c.deleted_at)}</td>
                  <td className={s.numCol}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleRestoreCard(c)}
                      disabled={restoring === c.id}
                    >
                      Восстановить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && items.length > 0 && (
        <section className={s.section}>
          <h2>Операции ({items.length})</h2>
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
        </section>
      )}
    </div>
  );
}
