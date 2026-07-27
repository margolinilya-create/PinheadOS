import { useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './ConfirmDialog.module.css';

/**
 * Shared confirmation dialog. Replaces window.confirm().
 *
 * Usage:
 *   const [confirmOpen, setConfirmOpen] = useState(false);
 *   <ConfirmDialog
 *     open={confirmOpen}
 *     title="Удалить заказ?"
 *     message="Действие нельзя отменить."
 *     confirmLabel="Удалить"
 *     variant="danger"
 *     onConfirm={() => { doDelete(); setConfirmOpen(false); }}
 *     onCancel={() => setConfirmOpen(false)}
 *   />
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  variant = 'default',
  /** { label, placeholder, required } — поле ввода вместо window.prompt() */
  prompt = null,
  onConfirm,
  onCancel,
}) {
  const ref = useFocusTrap(open, onCancel);
  // Поле чистится перемонтированием по nonce из стора (см. ConfirmDialogHost),
  // а не сбросом в эффекте — иначе прошлый комментарий подставился бы в новый перенос
  const [value, setValue] = useState('');

  if (!open) return null;
  const blocked = Boolean(prompt?.required) && !value.trim();
  const submit = () => { if (!blocked) onConfirm(value.trim()); };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div id="confirm-dialog-title" className={styles.title}>{title}</div>}
        {message && <div className={styles.message}>{message}</div>}
        {prompt && (
          <label className={styles.promptField}>
            <span className={styles.promptLabel}>{prompt.label}</span>
            <input
              className={styles.promptInput}
              value={value}
              placeholder={prompt.placeholder || ''}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${styles.confirm} ${variant === 'danger' ? styles.danger : ''}`}
            disabled={blocked}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
