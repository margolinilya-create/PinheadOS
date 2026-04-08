import { useState, useEffect, useRef } from 'react';
import useWorkshopStore from '../store/useWorkshopStore';
import styles from './NotificationBell.module.css';

const TYPE_ICONS = {
  started: '▶',
  blocked: '🔴',
  handoff: '→',
  complete: '✅',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const notifications = useWorkshopStore(s => s.notifications);
  const markNotificationsRead = useWorkshopStore(s => s.markNotificationsRead);
  const prevCount = useRef(notifications.length);

  const unread = notifications.filter(n => !n.read).length;

  // Browser push notification for new items
  useEffect(() => {
    if (notifications.length > prevCount.current) {
      const latest = notifications[0];
      if (latest && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`${latest.title}`, { body: latest.body, icon: '/favicon.ico' });
      }
    }
    prevCount.current = notifications.length;
  }, [notifications]);

  // Request permission on first render
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  function handleToggle() {
    if (!open && unread > 0) markNotificationsRead();
    setOpen(v => !v);
  }

  return (
    <div className={styles.wrap}>
      <button className={styles.bell} onClick={handleToggle}>
        🔔
        {unread > 0 && <span className={styles.badge}>{unread}</span>}
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.header}>Уведомления</div>
          {notifications.length === 0 ? (
            <div className={styles.empty}>Нет уведомлений</div>
          ) : (
            <div className={styles.list}>
              {notifications.slice(0, 20).map(n => (
                <div key={n.id} className={`${styles.item}${n.read ? '' : ' ' + styles.itemUnread}`}>
                  <span className={styles.itemIcon}>{TYPE_ICONS[n.type] || '•'}</span>
                  <div className={styles.itemContent}>
                    <span className={styles.itemTitle}>{n.title}</span>
                    <span className={styles.itemBody}>{n.body}</span>
                  </div>
                  <span className={styles.itemTime}>
                    {new Date(n.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} />}
    </div>
  );
}
