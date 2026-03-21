import { useToastStore } from '../../store/useToastStore';
import styles from './Toast.module.css';

export default function ToastContainer() {
  const toasts = useToastStore(s => s.toasts);
  const remove = useToastStore(s => s.remove);
  if (!toasts.length) return null;

  return (
    <div className={styles['toast-container']} role="alert" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[`toast-${t.type}`]}`} onClick={() => remove(t.id)}>
          <span className={styles['toast-icon']}>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : '!'}</span>
          <span className={styles['toast-msg']}>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
