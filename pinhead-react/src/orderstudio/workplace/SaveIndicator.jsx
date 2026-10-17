import { isEditable } from '../model/editable';
import styles from './Workplace.module.css';

/** Заказ ушёл из черновика: что сказать по его статусу */
const STATUS_TEXT = {
  price_review: 'Отправлен в работу — правка закрыта',
  quoted: 'Отправлен в работу — правка закрыта',
  ready_to_launch: 'Отправлен в работу — правка закрыта',
  cancel_requested: 'Отправлен в работу — правка закрыта',
  production: 'В производстве — только просмотр',
  done: 'Готов — только просмотр',
  archived: 'В архиве — только просмотр',
};

const STATE_TEXT = {
  clean: 'Сохранено',
  dirty: 'Сохраняю…',
  saving: 'Сохраняю…',
  error: 'Не сохранено — повторим при следующей правке',
  outdated: 'Вышло обновление — обновите страницу, последняя правка не сохранена',
  conflict: 'Заказ изменён в другой вкладке — обновите страницу',
  // Сервер ответил стражем, а перечитанный заказ ещё черновик — редкий случай
  locked: 'Отправлен в работу — правка закрыта',
};

/** Состояния, которые лечит только перезагрузка страницы */
const NEEDS_RELOAD = new Set(['outdated', 'conflict']);
const ALERT = new Set(['error', 'outdated', 'conflict']);

/** Текст индикатора: статус заказа важнее состояния сохранения */
function saveIndicatorText(order, saveState) {
  if (order && !isEditable(order)) return STATUS_TEXT[order.status] ?? STATE_TEXT.locked;
  return STATE_TEXT[saveState] ?? STATE_TEXT.clean;
}

/**
 * Состояние сохранения заказа на рабочем месте (веха 3). `role="status"` —
 * читалка экрана сообщает смену текста, не перехватывая фокус.
 * «Обновить страницу» — только там, где помогает лишь перезагрузка.
 */
export default function SaveIndicator({ order, saveState, onReload = () => window.location.reload() }) {
  const text = saveIndicatorText(order, saveState);
  const tone = order && !isEditable(order) ? styles.saveLocked : ALERT.has(saveState) ? styles.saveAlert : '';
  return (
    <div className={styles.save}>
      <span className={`${styles.saveText} ${tone}`.trim()} role="status" aria-live="polite">{text}</span>
      {isEditable(order) && NEEDS_RELOAD.has(saveState) && (
        <button type="button" className={styles.saveReload} onClick={onReload}>Обновить страницу</button>
      )}
    </div>
  );
}
