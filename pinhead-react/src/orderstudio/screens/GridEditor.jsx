import { SALES_SIZE_PRESETS as SIZE_PRESETS } from '../model/sizes';
import { gridQty } from '../model/factory';
import styles from './Sales.module.css';

/**
 * Сетка «цвет × размер» позиции v4. Размеры — ряды формы ERP
 * (копия `model/sizes`, сверена тестом): один ряд размеров на заказ и на цех.
 * Размер вне пресета, пришедший из данных, остаётся виден.
 */
export default function GridEditor({ grid, onChange }) {
  const sizes = grid.sizes;
  const universe = [...new Set([...SIZE_PRESETS.adult, ...SIZE_PRESETS.kids, ...sizes])];
  const kidsFirst = sizes.length > 0 && sizes.every((s) => SIZE_PRESETS.kids.includes(s));
  const shown = universe.filter((s) =>
    sizes.includes(s) || (kidsFirst ? SIZE_PRESETS.kids : SIZE_PRESETS.adult).includes(s));

  const setSizes = (next) => {
    const ordered = universe.filter((s) => next.includes(s));
    onChange({ ...grid, sizes: ordered });
  };
  const toggle = (s) => setSizes(sizes.includes(s) ? sizes.filter((x) => x !== s) : [...sizes, s]);
  const preset = (name) => setSizes(
    name === 'kids' ? ['104', '110', '116', '122', '128'] : ['S', 'M', 'L', 'XL'],
  );

  const setRow = (i, patch) => onChange({
    ...grid,
    rows: grid.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
  });
  const setCell = (i, size, raw) => {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    const row = grid.rows[i];
    setRow(i, { sizes: { ...row.sizes, [size]: n } });
  };
  const addRow = () => onChange({ ...grid, rows: [...grid.rows, { color: '', sizes: {} }] });
  const removeRow = (i) => onChange({ ...grid, rows: grid.rows.filter((_, j) => j !== i) });

  const colors = grid.rows.map((r) => r.color.trim().toLowerCase()).filter(Boolean);
  const duplicate = colors.find((c, i) => colors.indexOf(c) !== i);
  const total = gridQty(grid);

  return (
    <div>
      <div className={styles.row}>
        <span className={styles.muted}>Ряд:</span>
        <button type="button" className={styles.sizeToggle} onClick={() => preset('adult')}>Взрослый</button>
        <button type="button" className={styles.sizeToggle} onClick={() => preset('kids')}>Детский</button>
        <span className={styles.muted}>Размеры:</span>
        {shown.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={sizes.includes(s)}
            className={`${styles.sizeToggle}${sizes.includes(s) ? ` ${styles.sizeOn}` : ''}`}
            onClick={() => toggle(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {sizes.length > 0 && (
        <table className={styles.gridTable}>
          <thead>
            <tr>
              <th>Цвет</th>
              {sizes.map((s) => <th key={s}>{s}</th>)}
              <th>Итого</th>
              <th aria-label="Удалить" />
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    className={`${styles.input} ${styles.colorInput}`}
                    aria-label={`Цвет, строка ${i + 1}`}
                    placeholder="Цвет / Pantone"
                    value={row.color}
                    onChange={(e) => setRow(i, { color: e.target.value })}
                  />
                </td>
                {sizes.map((s) => (
                  <td key={s}>
                    <input
                      className={styles.cell}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      aria-label={`${row.color || `Строка ${i + 1}`}, ${s}`}
                      value={row.sizes[s] ?? ''}
                      onChange={(e) => setCell(i, s, e.target.value)}
                    />
                  </td>
                ))}
                <td className={styles.num}>{sizes.reduce((a, s) => a + (Number(row.sizes[s]) || 0), 0)}</td>
                <td>
                  <button type="button" className={styles.remove} onClick={() => removeRow(i)} aria-label={`Удалить строку ${i + 1}`}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.row}>
        <button type="button" className={styles.add} onClick={addRow} disabled={sizes.length === 0}>+ Цвет</button>
        <span className={styles.muted} data-testid="grid-total">Тираж: {total} шт.</span>
      </div>
      {sizes.length === 0 && <div className={styles.muted}>Выберите размеры, затем добавьте цвет.</div>}
      {duplicate && <div className={styles.issue}>Цвет «{duplicate}» указан дважды — объедините строки.</div>}
    </div>
  );
}
