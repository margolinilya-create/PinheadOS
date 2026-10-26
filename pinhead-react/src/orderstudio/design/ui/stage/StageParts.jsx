import { useId } from 'react';
import { defaultAreaId } from '../../geometry/view';
import { placeGeometry, viewPlacements, whereOf } from '../panel/panelOps';
import { PRESET_WIDTH_MM, studioPresets, withStudioPreset } from '../panel/presetOps';
import styles from './stage.module.css';

/*
 * Части сцены вкладки «Дизайн» 2.0 (веха 5в, Э2) — ОДИН ленивый модуль:
 * `DesignTab` берёт полосы через `React.lazy` от одного `import()`, поэтому
 * чанк один и запрос один. В чанк холста отсюда не попадает ничего.
 */

export const MSG_PICK_PRINT = 'Выберите нанесение на холсте';

/** Выбранное нанесение текущего вида и его зона; без выбора — зона по умолчанию вида */
function targetOf(d, item) {
  const entry = viewPlacements(item.prints, d.ctx, d.view).find((e) => e.print.key === d.selectedKey) ?? null;
  if (entry) {
    const where = whereOf(entry.pl, d.ctx);
    return where ? { entry, ...where } : null;
  }
  const view = d.flat.views.find((v) => v.kind === d.view);
  const areaId = defaultAreaId(d.flat, d.view);
  const area = view?.print_areas.find((a) => a.id === areaId);
  return view && area ? { entry: null, view, area } : null;
}

/** «Стандарты Pinhead»: пресеты вида с размером; без выбора — недоступны с причиной */
function PresetChips({ d, item }) {
  const id = useId();
  const t = targetOf(d, item);
  if (!t) return null;
  const reasonId = `${id}-reason`;
  const apply = (p) => {
    if (!t.entry) return;
    const sized = p.key in PRESET_WIDTH_MM;
    const g = withStudioPreset(t.view, t.area, t.entry.pl, p.key);
    d.commitPrints(sized ? `${p.label} (стандарт)` : p.label, (prints) => placeGeometry(prints, t.entry.print.key, g, d.ctx));
  };
  return (
    <div className={styles.group} role="group" aria-label="Стандарты Pinhead">
      <p className={styles.groupTitle} aria-hidden="true">Стандарты Pinhead</p>
      {studioPresets(t.view, t.area).map((p) => (
        <span key={p.key} className={styles.chip}>
          <button
            type="button"
            className={styles.chipBtn}
            aria-disabled={t.entry ? undefined : 'true'}
            aria-describedby={t.entry ? `${id}-${p.key}` : `${id}-${p.key} ${reasonId}`}
            onClick={() => apply(p)}
          >
            {p.label}
          </button>
          <span id={`${id}-${p.key}`} className={styles.hint}>{p.hint}</span>
        </span>
      ))}
      {!t.entry && <p id={reasonId} className={styles.hint}>{MSG_PICK_PRINT}</p>}
    </div>
  );
}

/** Полоса над холстом: стандарты (только черновик) */
export function StageTop({ d, item, readOnly }) {
  if (!d.flat || !d.ctx) return null;
  return (
    <div className={styles.bar}>
      {!readOnly && <PresetChips d={d} item={item} />}
    </div>
  );
}
