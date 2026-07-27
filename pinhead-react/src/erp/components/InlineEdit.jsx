import { useEffect, useRef, useState } from 'react';
import styles from '../erp.module.css';

/**
 * Инлайн-правка (паттерн kontora24 EditableField):
 * клик → input → Enter/blur сохраняет, Escape отменяет.
 * onSave(value) → Promise<boolean>; при false значение откатывается.
 */
export default function InlineEdit({
  value,
  onSave,
  type = 'text',
  placeholder = '—',
  format = (v) => v,
  ariaLabel,
  disabled = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const start = () => {
    if (disabled) return;
    setDraft(value ?? '');
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    const next = draft.trim();
    if (next === (value ?? '')) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next || null);
    setSaving(false);
    if (ok !== false) setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={styles.inlineEditBtn}
        onClick={start}
        title={disabled ? undefined : 'Нажмите, чтобы изменить'}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {value ? format(value) : <span className={styles.subText}>{placeholder}</span>}
        {!disabled && <span className={styles.inlineEditPen} aria-hidden="true">✎</span>}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type}
      className={`${styles.input} ${styles.inputXs}`}
      value={draft}
      disabled={saving}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Гасим события: контейнер карточки слушает Escape через useFocusTrap и
        // закрывал бы всю панель вместо отмены правки одного поля. Enter — чтобы
        // не всплыл до формы и не отправил её.
        if (e.key === 'Enter') { e.stopPropagation(); commit(); }
        if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
      }}
    />
  );
}
