import { useId } from 'react';
import { METHOD_LABELS, METHOD_ORDER, SCREEN_EFFECTS, EMBROIDERY_EFFECTS, rub } from './labels';
import styles from './Sales.module.css';

const toInt = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Нанесение позиции v4: техника, зона, группа размеров, мм, цвета, Pantone,
 * эффект, на крое / на готовом. Цена за штуку — из расчёта (`unitPrice`).
 */
export default function PrintRow({ print, index, itemSizes, zones, unitPrice, qty, onChange, onRemove }) {
  const id = useId();
  const m = print.method;
  const needsColors = m === 'silkscreen' || m === 'heat_transfer';
  const needsTextile = m === 'silkscreen' || m === 'dtg';
  const effects = m === 'silkscreen' ? SCREEN_EFFECTS : m === 'embroidery' ? EMBROIDERY_EFFECTS : null;

  const toggleSize = (s) => onChange({
    sizes: print.sizes.includes(s) ? print.sizes.filter((x) => x !== s) : [...print.sizes, s],
  });

  return (
    <div className={styles.subCard}>
      <div className={styles.subHead}>
        <span>Нанесение {index + 1} · {METHOD_LABELS[m]}</span>
        <span className={styles.row}>
          <span className={styles.muted}>{unitPrice != null ? `${rub(unitPrice)} × ${qty} шт.` : ''}</span>
          <button type="button" className={styles.remove} onClick={onRemove}>Удалить</button>
        </span>
      </div>
      <div className={styles.grid2}>
        <label className={styles.field}>Техника
          <select className={styles.select} value={m} onChange={(e) => onChange({ method: e.target.value, special: '' })}>
            {METHOD_ORDER.map((k) => <option key={k} value={k}>{METHOD_LABELS[k]}</option>)}
          </select>
        </label>
        <label className={styles.field}>Зона
          <input className={styles.input} list={`${id}-zones`} value={print.zone} onChange={(e) => onChange({ zone: e.target.value })} placeholder="Грудь, спина, рукав…" />
          <datalist id={`${id}-zones`}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </label>
        <label className={styles.field}>Ширина, мм
          <input className={styles.input} type="number" min="1" value={print.width_mm ?? ''} onChange={(e) => onChange({ width_mm: toInt(e.target.value) })} />
        </label>
        <label className={styles.field}>Высота, мм
          <input className={styles.input} type="number" min="1" value={print.height_mm ?? ''} onChange={(e) => onChange({ height_mm: toInt(e.target.value) })} />
        </label>
        {needsColors && (
          <label className={styles.field}>Цветов
            <input className={styles.input} type="number" min="1" max="8" value={print.colors} onChange={(e) => onChange({ colors: toInt(e.target.value) ?? 1 })} />
          </label>
        )}
        {needsTextile && (
          <label className={styles.field}>Изделие
            <select className={styles.select} value={print.textile} onChange={(e) => onChange({ textile: e.target.value })}>
              <option value="white">Белое / светлое</option>
              <option value="color">Цветное (подложка)</option>
            </select>
          </label>
        )}
        {m === 'embroidery' && (
          <label className={styles.field}>Заполнение, %
            <input className={styles.input} type="number" min="10" max="100" step="10" value={Math.round(print.fill * 100)} onChange={(e) => onChange({ fill: Math.min(1, Math.max(0.1, (Number(e.target.value) || 100) / 100)) })} />
          </label>
        )}
        {effects && (
          <label className={styles.field}>Эффект
            <select className={styles.select} value={print.special} onChange={(e) => onChange({ special: e.target.value })}>
              {effects.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
        )}
        <label className={styles.field}>Pantone (через запятую)
          <input
            className={styles.input}
            value={print.pantone.join(', ')}
            onChange={(e) => onChange({ pantone: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="186 C, Black C"
          />
        </label>
        <label className={styles.field}>Где наносим
          <select className={styles.select} value={print.on} onChange={(e) => onChange({ on: e.target.value })}>
            <option value="finished">На готовом изделии</option>
            <option value="cut">На крое</option>
          </select>
        </label>
        <label className={styles.field}>Отступ / привязка
          <input className={styles.input} value={print.offset_note} onChange={(e) => onChange({ offset_note: e.target.value })} placeholder="8 см от горловины" />
        </label>
        <label className={styles.field}>Ссылка на макет
          <input className={styles.input} value={print.artwork_url} onChange={(e) => onChange({ artwork_url: e.target.value })} placeholder="https://…" />
        </label>
      </div>
      {itemSizes.length > 0 && (
        <div className={styles.row}>
          <span className={styles.muted}>Размеры нанесения:</span>
          {itemSizes.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={print.sizes.includes(s)}
              className={`${styles.sizeToggle}${print.sizes.includes(s) ? ` ${styles.sizeOn}` : ''}`}
              onClick={() => toggleSize(s)}
            >
              {s}
            </button>
          ))}
          <span className={styles.muted}>{print.sizes.length === 0 ? 'все размеры' : ''}</span>
        </div>
      )}
      <label className={styles.field}>Комментарий
        <input className={styles.input} value={print.comment} onChange={(e) => onChange({ comment: e.target.value })} />
      </label>
    </div>
  );
}
