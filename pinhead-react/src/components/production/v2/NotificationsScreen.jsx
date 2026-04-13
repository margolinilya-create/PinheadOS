// redesign/v2 — full notifications feed
//
// Bell shows last 20; this screen shows full history (limit 50 from
// store) with filters and per-row mark-as-read. Same data source as
// Bell — useNotificationsStore — so realtime updates flow into both
// without extra plumbing.

import { useEffect, useMemo, useState } from 'react';
import { useNotificationsStore } from '../../../store/useNotificationsStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { Skeleton } from '../../shared/Skeleton';
import s from './v2.module.css';

const KIND_LABEL = {
  tech_card_approved: 'Tech card',
  piecework_entry_created: 'Сделка',
  payroll_batch_closed: 'Period',
  manual: 'Ручное',
};

const KIND_COLOR = {
  tech_card_approved: '#10b981',
  piecework_entry_created: '#2B2BF0',
  payroll_batch_closed: '#f59e0b',
  manual: '#64748b',
};

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { hour12: false });
  } catch {
    return iso;
  }
}

export default function NotificationsScreen() {
  useDocumentTitle('Уведомления');
  const notifications = useNotificationsStore((st) => st.notifications);
  const loading = useNotificationsStore((st) => st.loading);
  const loadRecent = useNotificationsStore((st) => st.loadRecent);
  const subscribe = useNotificationsStore((st) => st.subscribe);
  const unsubscribe = useNotificationsStore((st) => st.unsubscribe);
  const markAllRead = useNotificationsStore((st) => st.markAllRead);
  const markOneRead = useNotificationsStore((st) => st.markOneRead);

  const [filter, setFilter] = useState('all'); // all | unread | <kind>

  useEffect(() => {
    loadRecent();
    subscribe();
    return () => unsubscribe();
  }, [loadRecent, subscribe, unsubscribe]);

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    if (filter === 'unread') return notifications.filter((n) => !n.read_at);
    return notifications.filter((n) => n.kind === filter);
  }, [notifications, filter]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1>Уведомления</h1>
        {unreadCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={markAllRead}
          >
            Отметить все прочитанными ({unreadCount})
          </button>
        )}
      </div>
      <p className={s.subtitle}>
        Полный фид. Bell в углу показывает последние 20.
      </p>

      <div className={s.formRow}>
        <button
          type="button"
          className={`${s.navChip} ${filter === 'all' ? s.navChipActive : ''}`}
          onClick={() => setFilter('all')}
        >
          Все ({notifications.length})
        </button>
        <button
          type="button"
          className={`${s.navChip} ${filter === 'unread' ? s.navChipActive : ''}`}
          onClick={() => setFilter('unread')}
        >
          Непрочитанные ({unreadCount})
        </button>
        {Object.keys(KIND_LABEL).map((k) => (
          <button
            key={k}
            type="button"
            className={`${s.navChip} ${filter === k ? s.navChipActive : ''}`}
            onClick={() => setFilter(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {loading && notifications.length === 0 && (
        <div className={s.skeletonRow}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>🔔</span>
          <div className={s.emptyStateTitle}>Ничего нет</div>
          <p>{filter === 'all' ? 'Уведомлений пока нет.' : 'Под текущий фильтр ничего не подходит.'}</p>
        </div>
      )}

      {filtered.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {filtered.map((n) => (
            <li
              key={n.id}
              className={`${s.card} ${!n.read_at ? s.cardClickable : ''}`}
              style={!n.read_at ? { borderLeft: `3px solid ${KIND_COLOR[n.kind] ?? 'var(--accent)'}` } : undefined}
              onClick={() => !n.read_at && markOneRead(n.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span
                      className={s.badge}
                      style={{ background: `${KIND_COLOR[n.kind] ?? '#64748b'}22`, color: KIND_COLOR[n.kind] ?? '#64748b' }}
                    >
                      {KIND_LABEL[n.kind] ?? n.kind}
                    </span>
                    <strong>{n.title}</strong>
                    {!n.read_at && (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>● NEW</span>
                    )}
                  </div>
                  {n.body && <div className={s.subtitle} style={{ margin: '4px 0' }}>{n.body}</div>}
                </div>
                <div className={s.subtitle} style={{ margin: 0, whiteSpace: 'nowrap' }}>
                  {formatTime(n.created_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
