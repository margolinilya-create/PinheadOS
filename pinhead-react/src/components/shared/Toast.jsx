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
 *
 * ── У РЕГИОНА ЕСТЬ ИМЯ ───────────────────────────────────────────────────────
 *
 * `role="status"` на странице не один: `erp/components/StaleDataBar` объявляет
 * им же «Обновляем данные…». Два безымянных региона одной роли неразличимы —
 * и для скринридера («статус» и «статус»), и для любого поиска по роли.
 * Именно на этом упал e2e: `getByRole('status')` совпал с обоими, и падение
 * зависело от того, шло ли в этот момент переподключение realtime, — то есть
 * выглядело случайным, а было неоднозначностью разметки.
 *
 * Имя НЕ «Уведомления»: так подписан колокол производственных уведомлений
 * в шапке ERP (`ErpLayout`), и совпадение имён вернуло бы ту же беду
 * на соседней роли.
 */
export default function ToastContainer() {
  const { toasts, remove } = useToastStore(useShallow(s => ({ toasts: s.toasts, remove: s.remove })));

  return (
    <div
      className={`${styles['toast-container']} ${toasts.length === 0 ? styles['toast-container-empty'] : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Оповещения"
    >
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[`toast-${t.type}`]}`} onClick={() => remove(t.id)}>
          <span className={styles['toast-icon']}>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : '!'}</span>
          <span className={styles['toast-msg']}>{t.message}</span>
          {/* Повторы одного сообщения считаются, а не копятся отдельными полосами */}
          {t.count > 1 && <span className={styles['toast-count']}>×{t.count}</span>}
        </div>
      ))}
    </div>
  );
}
