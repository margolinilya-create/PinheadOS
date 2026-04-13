// redesign/v2 — Notifications bell
//
// Reads from notifications table (populated by dispatcher consumer).
// Title/body come from the dispatcher, no event_type leakage to UI.
// Mark-as-read is persistent — survives refresh.

import { useEffect, useState } from 'react';
import { useNotificationsStore } from '../../../store/useNotificationsStore';
import s from './v2.module.css';

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { hour12: false });
  } catch {
    return iso;
  }
}

export default function NotificationsBell() {
  const notifications = useNotificationsStore((st) => st.notifications);
  const loadRecent = useNotificationsStore((st) => st.loadRecent);
  const subscribe = useNotificationsStore((st) => st.subscribe);
  const unsubscribe = useNotificationsStore((st) => st.unsubscribe);
  const markAllRead = useNotificationsStore((st) => st.markAllRead);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadRecent();
    subscribe();
    return () => unsubscribe();
  }, [loadRecent, subscribe, unsubscribe]);

  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <div className={s.bellWrap}>
      <button
        type="button"
        className={s.bellBtn}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markAllRead();
        }}
        aria-label={`Уведомления (${unread} непрочитанных)`}
      >
        🔔
        {unread > 0 && (
          <span className={s.bellBadge}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className={s.bellDropdown}>
          <div className={s.bellDropdownHeader}>
            <strong>Уведомления</strong>
            <button type="button" className={s.removeBtn} onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
          </div>
          {notifications.length === 0 ? (
            <p className={s.empty}>Пока ничего</p>
          ) : (
            <ul className={s.bellList}>
              {notifications.slice(0, 20).map((n) => (
                <li
                  key={n.id}
                  className={s.bellItem}
                  style={!n.read_at ? { background: 'var(--accent-light)' } : undefined}
                >
                  <div className={s.bellItemTitle}>{n.title}</div>
                  {n.body && <div className={s.bellItemMeta}>{n.body}</div>}
                  <div className={s.bellItemTime}>{formatTime(n.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
