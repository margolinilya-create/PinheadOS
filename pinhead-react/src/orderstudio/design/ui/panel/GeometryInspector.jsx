import { useEffect, useId, useRef, useState } from 'react';
import { DesignIcon } from '../DesignIcon';
import { METHOD_LABELS, METHOD_ORDER, allowedMethods, printMethodProfile } from '../../../model/printMethods';
import { printQuality } from '../../catalog/dpi';
import MmField from './MmField';
import {
  horizontalOffset, presetsFor, resized, rotated, verticalLabel, verticalOffset, whereOf,
  withHorizontalOffset, withPreset, withVerticalOffset,
} from './panelOps';
import styles from '../DesignTab.module.css';

/** Подпись качества макета на текущем размере (перенос DM `DpiBadge`) */
function qualityText(pl, profile) {
  const { quality, dpi } = printQuality(pl.asset, pl.width_mm, profile);
  const d = Math.round(dpi ?? 0);
  if (quality === 'vector') return { text: 'Вектор — без потери качества' };
  if (quality === 'good') return { text: `${d} DPI — отличное качество` };
  if (quality === 'mid') return { text: `${d} DPI — приемлемо, лучше от ${profile.dpi?.good ?? 300}`, level: 'warn' };
  if (quality === 'low') return { text: `${d} DPI — печать будет размытой`, level: 'serious' };
  if (quality === 'embroidery' && profile.detail) {
    return { text: `Вышивка: линии от ${profile.detail.minLineMm} мм, текст от ${profile.detail.minTextMm} мм` };
  }
  return null;
}

/**
 * Инспектор выбранного нанесения (перенос DM `PlacementInspector`, геометрия):
 * техника (только допустимые в зоне, недопустимая — с пометкой), пресеты,
 * Ш × В со связью пропорцией (замок), отступы от опоры и от центра, поворот,
 * отражение, качество макета. Правка — `onGeometry(geometry, label, key?)`
 * и `onMethod(method)`; запись и история — у вкладки.
 */
export default function GeometryInspector({ entry, ctx, rules, readOnly, autoFocus, onFocused, onGeometry, onMethod }) {
  const methodId = useId();
  const widthRef = useRef(null);
  const [locked, setLocked] = useState(true);
  useEffect(() => {
    if (!autoFocus || !widthRef.current) return;
    widthRef.current.focus();
    widthRef.current.select?.();
    onFocused?.();
  }, [autoFocus, onFocused]);

  const { print, index, pl } = entry;
  const where = whereOf(pl, ctx);
  if (!where) return null;
  const { view, area } = where;
  const allowed = allowedMethods(area, rules);
  const profile = printMethodProfile(print.method);
  const quality = qualityText(pl, profile);
  const geo = (g, label, key) => onGeometry(g, label, key);
  const off = !readOnly;

  return (
    <section className={styles.section} aria-label={`Нанесение ${index + 1}: размер и место`}>
      <h3 className={styles.sectionTitle}>Нанесение {index + 1} · {area.name}</h3>

      <label className={styles.field} htmlFor={methodId}>Техника
        <select id={methodId} className={styles.select} value={print.method} disabled={readOnly} onChange={(e) => onMethod(e.target.value)}>
          {METHOD_ORDER.map((m) => (
            <option key={m} value={m}>{METHOD_LABELS[m]}{allowed.includes(m) ? '' : ' — не для этой зоны'}</option>
          ))}
        </select>
      </label>
      {!allowed.includes(print.method) && (
        <p className={`${styles.notice} ${styles.warn}`}>Техника «{profile.label}» не для зоны «{area.name}» — проверьте с производством.</p>
      )}

      {off && (
        <div className={styles.row} role="group" aria-label="Положение одной кнопкой">
          {presetsFor(view, area).map((p) => (
            <button key={p.key} type="button" className={styles.btn} onClick={() => geo(withPreset(view, area, pl, p.key), p.label)}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.grid2}>
        <MmField ref={widthRef} label="Ширина, мм" value={pl.width_mm} min={1} readOnly={readOnly}
          onCommit={(v) => geo(resized(pl, { width: v }, locked), 'Размер', `size:${print.key}`)} />
        <MmField label="Высота, мм" value={pl.height_mm} min={1} readOnly={readOnly}
          onCommit={(v) => geo(resized(pl, { height: v }, locked), 'Размер', `size:${print.key}`)} />
        <MmField label={verticalLabel(view, area, ctx.category)} value={verticalOffset(view, area, pl)} readOnly={readOnly}
          onCommit={(v) => geo(withVerticalOffset(view, area, pl, v), 'Отступ', `off:${print.key}`)} />
        <MmField label="От центра, мм (+ вправо)" value={horizontalOffset(view, area, pl)} readOnly={readOnly}
          onCommit={(v) => geo(withHorizontalOffset(view, area, pl, v), 'Отступ', `off:${print.key}`)} />
        <MmField label="Поворот, °" value={pl.rotation_deg} digits={1} readOnly={readOnly}
          onCommit={(v) => geo(rotated({ ...pl, rotation_deg: 0 }, v), 'Поворот', `rot:${print.key}`)} />
      </div>

      {off && (
        <div className={styles.row}>
          <button type="button" className={styles.iconBtn} aria-pressed={locked} onClick={() => setLocked((x) => !x)}
            aria-label={locked ? 'Пропорции связаны — развязать' : 'Пропорции свободны — связать'}>
            <DesignIcon name={locked ? 'lock' : 'unlock'} />
          </button>
          <button type="button" className={styles.iconBtn} onClick={() => geo(rotated(pl, -90), 'Поворот')} aria-label="Повернуть на 90° против часовой">
            <DesignIcon name="rotateCcw" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={() => geo(rotated(pl, 90), 'Поворот')} aria-label="Повернуть на 90° по часовой">
            <DesignIcon name="rotateCw" />
          </button>
          <button type="button" className={styles.iconBtn} aria-pressed={pl.flip_h} onClick={() => geo({ ...pl, flip_h: !pl.flip_h }, 'Отражение')} aria-label="Отразить по горизонтали">
            <DesignIcon name="flipH" />
          </button>
          <button type="button" className={styles.iconBtn} aria-pressed={pl.flip_v} onClick={() => geo({ ...pl, flip_v: !pl.flip_v }, 'Отражение')} aria-label="Отразить по вертикали">
            <DesignIcon name="flipV" />
          </button>
        </div>
      )}

      {pl.asset.size_estimated && <p className={`${styles.notice} ${styles.warn}`}>Размер файла оценочный — проверьте Ш × В.</p>}
      {quality && (
        <p className={`${styles.muted}${quality.level === 'serious' ? ` ${styles.serious}` : quality.level ? ` ${styles.warnText}` : ''}`}>
          {quality.text}
        </p>
      )}
    </section>
  );
}
