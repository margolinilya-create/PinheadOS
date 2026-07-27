import { useState } from 'react';
import { SIZE_PRESETS, SIZE_PRESET_LABELS, gridTotal, toggleSize } from '../../../utils/orderForm';
import styles from '../../../erp.module.css';

/**
 * Редактор размерной сетки позиции: чипсы-пресеты размеров, строки цветов,
 * сумма по сетке = тираж позиции.
 *
 * Вынесено из CreateOrderModal (1247 строк — самый большой файл проекта):
 * компонент самодостаточный, зависит только от grid/onChange.
 */
export function SizeGridEditor({ grid, onChange }) {
  const sizes = grid?.sizes ?? [];
  const rows = grid?.rows ?? [];
  const [preset, setPreset] = useState(() => {
    const inKids = sizes.some((s) => SIZE_PRESETS.kids.includes(s));
    const inAdult = sizes.some((s) => SIZE_PRESETS.adult.includes(s));
    return inKids && !inAdult ? 'kids' : 'adult';
  });
  const [customSize, setCustomSize] = useState('');
  const set = (patch) => onChange({ sizes, rows, ...patch });
  const total = gridTotal(grid);

  const onToggleSize = (sz) => {
    const g = toggleSize(grid, sz);
    // первая активация размера — сразу даём строку цвета для ввода количеств
    onChange(g.sizes.length > 0 && (g.rows?.length ?? 0) === 0
      ? { ...g, rows: [{ color: '', sizes: {} }] }
      : g);
  };

  const addCustom = () => {
    const v = customSize.trim();
    if (!v) return;
    if (!sizes.includes(v)) onToggleSize(v);
    setCustomSize('');
  };

  const presetSizes = preset === 'custom' ? [] : SIZE_PRESETS[preset];
  const shownSizes = [...presetSizes, ...sizes.filter((s) => !presetSizes.includes(s))];

  return (
    <div className={styles.sizeGrid}>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Шкала</span>
        <div className={styles.tileRow} role="radiogroup" aria-label="Шкала размеров">
          {Object.entries(SIZE_PRESET_LABELS).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={preset === v}
              className={`${styles.tile} ${styles.tileSm} ${preset === v ? styles.tileActive : ''}`}
              onClick={() => setPreset(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Размеры</span>
        <div className={styles.tileRow} aria-label="Размеры сетки">
          {shownSizes.map((sz) => (
            <button
              key={sz}
              type="button"
              aria-pressed={sizes.includes(sz)}
              className={`${styles.tile} ${styles.tileSm} ${sizes.includes(sz) ? styles.tileActive : ''}`}
              onClick={() => onToggleSize(sz)}
            >
              {sz}
            </button>
          ))}
          {shownSizes.length === 0 && (
            <span className={styles.subText}>Добавьте свой размер ниже</span>
          )}
        </div>
      </div>
      {preset === 'custom' && (
        <div className={styles.checkRow}>
          <input
            className={`${styles.input} ${styles.inputSm} ${styles.customSizeInput}`}
            placeholder="Размер (56, 4XL…)"
            aria-label="Свой размер"
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
            }}
          />
          <button type="button" className="btn btn-secondary" onClick={addCustom}>
            Добавить
          </button>
        </div>
      )}
      {sizes.length > 0 && (
        <div className={styles.checkRow}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => set({ rows: [...rows, { color: '', sizes: {} }] })}
          >
            + Цвет
          </button>
        </div>
      )}
      {sizes.length > 0 && rows.map((row, ri) => (
        <div key={ri} className={styles.checkRow}>
          <input
            className={`${styles.input} ${styles.inputSm} ${styles.colorInput}`}
            placeholder="Цвет"
            value={row.color}
            aria-label={`Цвет ${ri + 1}`}
            onChange={(e) =>
              set({ rows: rows.map((r, i) => (i === ri ? { ...r, color: e.target.value } : r)) })}
          />
          {sizes.map((sz) => (
            <label key={sz} className={styles.checkLabel} style={{ gap: 3 }}>
              <span className={styles.subText}>{sz}</span>
              <input
                type="number"
                min="0"
                className={`${styles.input} ${styles.inputSm} ${styles.qtyCellInput}`}
                value={row.sizes[sz] ?? ''}
                aria-label={`${row.color || 'цвет'} ${sz}`}
                onChange={(e) =>
                  set({
                    rows: rows.map((r, i) =>
                      i === ri
                        ? { ...r, sizes: { ...r.sizes, [sz]: Number(e.target.value) || 0 } }
                        : r),
                  })}
              />
            </label>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Убрать цвет"
            onClick={() => set({ rows: rows.filter((_, i) => i !== ri) })}
          >
            ✕
          </button>
        </div>
      ))}
      <div className={styles.subText} aria-live="polite">
        Сумма по сетке: <strong>{total} шт</strong>
        {total > 0 && ' — подставится в количество позиции'}
      </div>
    </div>
  );
}

/** Сворачиваемая секция формы: заголовок с chevron + краткое резюме, когда свёрнута */
