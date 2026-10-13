import { LABEL_TYPE_TO_ERP } from '../bridge/erpNames';
import styles from './Sales.module.css';

/** Коды — как в справочнике ERP `label_type` (+ хэнгтег, стикер, патч из v4) */
const LABEL_TYPES = Object.entries(LABEL_TYPE_TO_ERP).map(([key, label]) => ({ key, label }));

/** Бирка позиции v4 (v4 §4.2 п. 5). Библиотека бирок — следующий срез */
export default function LabelRow({ label, index, onChange, onRemove }) {
  return (
    <div className={styles.subCard}>
      <div className={styles.subHead}>
        <span>Бирка {index + 1}</span>
        <button type="button" className={styles.remove} onClick={onRemove}>Удалить</button>
      </div>
      <div className={styles.grid2}>
        <label className={styles.field}>Тип
          <select className={styles.select} value={label.label_type} onChange={(e) => onChange({ label_type: e.target.value })}>
            <option value="">—</option>
            {LABEL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Где
          <input className={styles.input} value={label.place} onChange={(e) => onChange({ place: e.target.value })} placeholder="Левый боковой шов" />
        </label>
        <label className={styles.field}>Размер
          <input className={styles.input} value={label.size} onChange={(e) => onChange({ size: e.target.value })} placeholder="30×60 мм" />
        </label>
        <label className={styles.field}>Комментарий
          <input className={styles.input} value={label.comment} onChange={(e) => onChange({ comment: e.target.value })} />
        </label>
      </div>
    </div>
  );
}
