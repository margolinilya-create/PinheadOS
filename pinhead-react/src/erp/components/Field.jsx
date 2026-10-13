import { useId } from 'react';
import styles from './Field.module.css';

/**
 * Поле формы ERP: подпись + контрол + подсказка/ошибка, связанные по id.
 *
 * `as` выбирает контрол: 'input' (по умолчанию), 'select', 'textarea'.
 * Ошибка автоматически ставит `aria-invalid` и связывает текст через
 * `aria-describedby` — раньше это делалось вручную и терялось.
 *
 * Остальные пропы уходят на сам контрол (type, value, onChange, min, …).
 */
export function Field({
  label,
  error,
  hint,
  required = false,
  as = 'input',
  className = '',
  fieldClassName = '',
  children,
  ...rest
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;

  const Control = as;
  const controlProps = {
    id,
    className: [styles.control, error && styles.invalid, className].filter(Boolean).join(' '),
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
    required,
    ...rest,
  };

  return (
    <div className={`${styles.field} ${fieldClassName}`.trim()}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
          {required && <span className={styles.required} aria-hidden="true">*</span>}
        </label>
      )}
      {/* input — void-элемент: детей ему не передаём вовсе */}
      {as === 'input'
        ? <input {...controlProps} />
        : <Control {...controlProps}>{children}</Control>}
      {hint && !error && <span id={hintId} className={styles.hint}>{hint}</span>}
      {error && <span id={errorId} className={styles.error}>{error}</span>}
    </div>
  );
}
