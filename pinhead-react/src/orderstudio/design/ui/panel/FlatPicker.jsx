import { useId } from 'react';
import styles from '../DesignTab.module.css';

const label = (f) => `${f.name}${f.typical ? ' — типовой' : ''}`;

/**
 * Выбор силуэта позиции (план, решение 7). Типовой отмечен текстом. Смена —
 * через `onPick(flat)` (подтверждение и перенос нанесений — у вкладки).
 * Только чтение — название текстом, без выбора.
 */
export default function FlatPicker({ flats, current, readOnly, onPick }) {
  const id = useId();
  if (!current) return null;
  if (readOnly) {
    return <p className={styles.muted}>Силуэт: {label(current)}</p>;
  }
  const list = flats.some((f) => f.id === current.id) ? flats : [current, ...flats];
  return (
    <label className={styles.field} htmlFor={id}>Силуэт
      <select
        id={id}
        className={styles.select}
        value={current.id}
        onChange={(e) => onPick(list.find((f) => f.id === e.target.value) ?? null)}
      >
        {list.map((f) => <option key={f.id} value={f.id}>{label(f)}</option>)}
      </select>
    </label>
  );
}
