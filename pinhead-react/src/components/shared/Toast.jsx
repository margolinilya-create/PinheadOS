import { useShallow } from 'zustand/react/shallow';
import { useToastStore } from '../../store/useToastStore';
import styles from './Toast.module.css';

/**
 * Контейнер тостов.
 *
 * Live-регион смонтирован ВСЕГДА, даже когда тостов нет. Раньше здесь стоял
 * `if (!toasts.length) return null`, и весь контейнер вместе с `aria-live`
 * появлялся в DOM одновременно с первым сообщением. Так объявление не
 * работает: скринридер следит за ИЗМЕНЕНИЯМИ внутри уже существующего
 * региона, а регион, добавленный вместе с содержимым, он не отслеживает.
 * То есть `aria-live` стоял, а озвучивания не было — самый неприятный случай,
 * потому что в разметке всё выглядит правильным.
 *
 * Пустой контейнер безвреден: он ничего не рисует и не перехватывает клики
 * (`pointer-events: none` до появления тостов — см. Toast.module.css).
 */
export default function ToastContainer() {
  const { toasts, remove } = useToastStore(useShallow(s => ({ toasts: s.toasts, remove: s.remove })));

  return (
    <div
      className={`${styles['toast-container']} ${toasts.length === 0 ? styles['toast-container-empty'] : ''}`}
      role="status"
      aria-live="polite"
    >
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[`toast-${t.type}`]}`} onClick={() => remove(t.id)}>
          <span className={styles['toast-icon']}>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : '!'}</span>
          <span className={styles['toast-msg']}>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
