// redesign/v2 — Notifications bell (W3 Day-5)
//
// Fixed-position corner widget. On mount: loads recent events and
// subscribes to realtime INSERTs. Click opens a dropdown with the
// latest 20, clicking "mark all seen" stores a timestamp in
// localStorage and zeros the unread badge.
//
// Intentionally self-contained — does NOT touch Header.jsx (red zone
// for main/v2 merge conflicts per ADR-0009).

import { useEffect, useState } from 'react';
import { useNotificationsStore } from '../../../store/useNotificationsStore';

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { hour12: false });
  } catch {
    return iso;
  }
}

export default function NotificationsBell() {
  const events = useNotificationsStore((s) => s.events);
  const seenAt = useNotificationsStore((s) => s.seenAt);
  const loadRecent = useNotificationsStore((s) => s.loadRecent);
  const subscribe = useNotificationsStore((s) => s.subscribe);
  const unsubscribe = useNotificationsStore((s) => s.unsubscribe);
  const markAllSeen = useNotificationsStore((s) => s.markAllSeen);

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
    <div
      style={{
        position: 'fixed',
        top: 60,
        right: 20,
        zIndex: 100,
      }}
    >
      <button
        className="btn btn-ghost"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markAllSeen();
        }}
        aria-label={`Уведомления (${unread} непрочитанных)`}
        style={{
          position: 'relative',
          width: 40,
          height: 40,
          borderRadius: '50%',
          fontSize: '1.3em',
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#ef4444',
              color: 'white',
              borderRadius: '999px',
              fontSize: '0.7em',
              fontWeight: 700,
              minWidth: 18,
              padding: '2px 5px',
              lineHeight: 1,
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="panel"
          style={{
            position: 'absolute',
            top: 48,
            right: 0,
            width: 360,
            maxHeight: 500,
            overflowY: 'auto',
            padding: 'var(--space-2)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <strong>Уведомления</strong>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>×</button>
          </div>
          {events.length === 0 ? (
            <p style={{ opacity: 0.5, textAlign: 'center' }}>Пока ничего</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {events.slice(0, 20).map((e) => (
                <li
                  key={e.id}
                  style={{
                    padding: 'var(--space-2)',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    fontSize: '0.85em',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{e.event_type}</div>
                  <div style={{ opacity: 0.6 }}>
                    {e.aggregate_type}: {e.aggregate_id.slice(0, 8)}…
                  </div>
                  <div style={{ opacity: 0.5, fontSize: '0.9em', marginTop: 2 }}>
                    {formatTime(e.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
