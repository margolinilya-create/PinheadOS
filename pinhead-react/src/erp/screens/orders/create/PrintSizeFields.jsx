import styles from '../../../styles';
import { FieldError } from './FormParts';

/**
 * «В, мм» и «Ш, мм» нанесения. Размер — целые миллиметры: колонки
 * `erp_item_prints.width_mm/height_mm` целочисленные, и дробь, пропущенная
 * формой, роняла создание всего заказа (ошибка с боя 08.10). Проверку
 * делает `validateOrderForm` (ключ `item_{i}_print_{pi}_size`), здесь —
 * подсветка, автоскролл (`data-invalid`) и текст под полями.
 */
export function PrintSizeFields({ print, error, errorId, onChange }) {
  const invalid = error ? true : undefined;
  const field = (key, label) => (
    <label className={`${styles.checkLabel} ${styles.mmLabel}`} style={{ gap: 3 }}>
      <span className={styles.subText}>{label}</span>
      <input type="number" min="1" step="1"
        className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
        aria-invalid={invalid} data-invalid={invalid}
        aria-describedby={error ? errorId : undefined}
        value={print[key]}
        onChange={(e) => onChange({ [key]: e.target.value })} />
    </label>
  );
  return (
    <>
      {field('height_mm', 'В, мм')}
      {field('width_mm', 'Ш, мм')}
      <FieldError id={errorId} text={error} />
    </>
  );
}
