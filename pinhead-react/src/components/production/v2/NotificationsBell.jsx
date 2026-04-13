// redesign/v2 — Notifications bell
//
// Fixed-position corner widget. On mount: loads recent events and
// subscribes to realtime INSERTs. Click opens a dropdown with the
// latest 20, marking all as seen on first open.

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
  const events = useNotificationsStore((st) => st.events);
  const seenAt = useNotificationsStore((st) => st.seenAt);
  const loadRecent = useNotificationsStore((st) => st.loadRecent);
  const subscribe = useNotificationsStore((st) => st.subscribe);
  const unsubscribe = useNotificationsStore((st) => st.unsubscribe);
  const markAllSeen = useNotificationsStore((st) => st.markAllSeen);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadRecent();
    subscribe();
    return () => unsubscribe();
  }, [loadRecent, subscribe, unsubscribe]);

  const unread = seenAt
    ? events.filter((e) => e.created_at > seenAt).length
    : events.length;

  return (
    <div className={s.bellWrap}>
      <button
        type="button"
        className={s.bellBtn}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markAllSeen();
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
          {events.length === 0 ? (
            <p className={s.empty}>Пока ничего</p>
          ) : (
            <ul className={s.bellList}>
              {events.slice(0, 20).map((e) => (
                <li key={e.id} className={s.bellItem}>
                  <div className={s.bellItemTitle}>{e.event_type}</div>
                  <div className={s.bellItemMeta}>
                    {e.aggregate_type}: {e.aggregate_id.slice(0, 8)}…
                  </div>
                  <div className={s.bellItemTime}>{formatTime(e.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
