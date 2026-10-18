import BufferedInput from '../../screens/BufferedInput';
import { errorTextId, fieldAria, hintTextId } from './flatEditorView';
import { parseMm } from './flatParse';
import base from '../../screens/Sales.module.css';
import styles from './FlatEditor.module.css';

const formatMm = (v) => (v == null || Number.isNaN(v) ? '' : String(v).replace('.', ','));

/** Текст ошибок поля — по нему `aria-describedby` */
export function FieldErrors({ id, errors }) {
  if (!errors?.length) return null;
  return <span id={errorTextId(id)} className={styles.fieldError}>{errors.join('; ')}</span>;
}

/**
 * Поле: подпись (только название — короткое доступное имя), контрол, подсказка
 * и ошибки под ним; контрол ссылается на них `aria-describedby` (`fieldAria`)
 */
export function Field({ id, label, hint, errors, children }) {
  return (
    <div className={base.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span id={hintTextId(id)} className={styles.hint}>{hint}</span>}
      <FieldErrors id={id} errors={errors} />
    </div>
  );
}

/**
 * Числовое поле в мм: буфер набора (blur и Enter, запятая как точка),
 * ошибка — `aria-invalid` и `aria-describedby` на её текст
 */
export function MmField({ id, label, value, onCommit, min = 0, max = 5000, errors, hint, disabled, optional = false }) {
  return (
    <Field id={id} label={label} hint={hint} errors={errors}>
      <BufferedInput
        {...fieldAria(id, errors, hint)}
        className={base.input}
        inputMode="decimal"
        value={value}
        format={formatMm}
        parse={(t) => parseMm(t, min, max, optional)}
        onCommit={onCommit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        disabled={disabled}
      />
    </Field>
  );
}
