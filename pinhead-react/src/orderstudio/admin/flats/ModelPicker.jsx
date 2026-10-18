import { useState } from 'react';
import { FlatIcon } from './FlatIcon';
import base from '../../screens/Sales.module.css';
import styles from './FlatEditor.module.css';

const MAX_HITS = 8;

/**
 * Модели прайс-каталога (`sku_catalog`) для точного силуэта: поиск по коду
 * и названию, выбранные — чипами. Неизвестный код (модели нет в каталоге)
 * остаётся чипом — его подсвечивает проверка флэта.
 */
export default function ModelPicker({ id, label, skus, value, onChange, describedBy }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const hits = q
    ? skus.filter((s) => !value.includes(s.code) && (`${s.code} ${s.name}`).toLowerCase().includes(q)).slice(0, MAX_HITS)
    : [];
  const byCode = new Map(skus.map((s) => [s.code, s]));

  return (
    <div className={styles.models}>
      <label className={base.field} htmlFor={id}>
        {label}
        <input id={id} className={base.input} type="search" value={query} placeholder="Код или название модели"
          onChange={(e) => setQuery(e.target.value)} aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} />
      </label>
      {hits.length > 0 && (
        <ul className={styles.hits} aria-label="Найденные модели">
          {hits.map((s) => (
            <li key={s.code}>
              <button type="button" className={styles.pick} onClick={() => { onChange([...value, s.code]); setQuery(''); }}>
                {`${s.code} — ${s.name}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q && hits.length === 0 && <p className={styles.hint}>Моделей не найдено</p>}
      {value.length > 0 && (
        <ul className={styles.chips} aria-label="Выбранные модели">
          {value.map((code) => (
            <li key={code} className={styles.chip}>
              {byCode.get(code) ? `${code} — ${byCode.get(code).name}` : code}
              <button type="button" className={styles.chipX} aria-label={`Убрать модель ${code}`} onClick={() => onChange(value.filter((c) => c !== code))}>
                <FlatIcon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
