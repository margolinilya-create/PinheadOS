import { forwardRef, useId, useState } from 'react';
import styles from '../DesignTab.module.css';

const round = (v, digits) => {
  const k = 10 ** digits;
  return String(Math.round(v * k) / k);
};

/**
 * Число инспектора: правка уходит на потере фокуса и по Enter (план,
 * решение 5), не на каждом нажатии — иначе «120» прошло бы через 1 и 12,
 * и холст с ценой прыгали бы. Пока поле не в фокусе, оно следует за
 * значением (перетаскивание, стрелки на холсте). Esc — вернуть прежнее.
 */
const MmField = forwardRef(function MmField({ label, value, digits = 0, min, onCommit, readOnly }, ref) {
  const id = useId();
  const [draft, setDraft] = useState(null);
  const shown = draft ?? round(value, digits);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const n = Number.parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(n)) return;
    const v = min !== undefined ? Math.max(min, n) : n;
    if (round(v, digits) !== round(value, digits)) onCommit(v);
  };

  return (
    <label className={styles.field} htmlFor={id}>{label}
      <input
        ref={ref}
        id={id}
        className={styles.input}
        inputMode="decimal"
        value={shown}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
});

export default MmField;
