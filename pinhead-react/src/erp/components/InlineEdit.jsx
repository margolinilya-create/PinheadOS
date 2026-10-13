import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
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
  const btnRef = useRef(null);
  /**
   * ВОЗВРАТ ФОКУСА НА КНОПКУ ПОСЛЕ ПРАВКИ (правка 03.09).
   *
   * `<input>` размонтируется на сохранении и на Escape, и фокус улетал
   * в `<body>` — следующий Tab начинал обход страницы заново. В карточке
   * заказа таких правок десяток, то есть клавиатурный пользователь после
   * каждой возвращался в начало (WCAG 2.4.3).
   *
   * Возвращаем только когда правку закрыл сам человек, а не потеря фокуса
   * (`onBlur` — он ушёл дальше сам, и тянуть его назад было бы хуже).
   */
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); return; }
    if (returnFocus.current) {
      returnFocus.current = false;
      btnRef.current?.focus();
    }
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
        ref={btnRef}
        className={styles.inlineEditBtn}
        onClick={start}
        title={disabled ? undefined : 'Нажмите, чтобы изменить'}
        // aria-label перекрывает содержимое кнопки: со «Менеджер» скринридер
        // озвучивал только подпись, без самого значения
        aria-label={`${ariaLabel}: ${value ? format(value) : 'не указано'}`}
        disabled={disabled}
      >
        {value ? format(value) : <span className={styles.subText}>{placeholder}</span>}
        {!disabled && <span className={styles.inlineEditPen}><Icon name="pencil" size={13} /></span>}
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
        if (e.key === 'Enter') { e.stopPropagation(); returnFocus.current = true; commit(); }
        if (e.key === 'Escape') {
          e.stopPropagation();
          returnFocus.current = true;
          setEditing(false);
        }
      }}
    />
  );
}
