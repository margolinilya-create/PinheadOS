import { useEffect, useId, useMemo, useState } from 'react';
import { pluralize } from '../../../../utils/i18n';
import { defaultAreaId } from '../../geometry/view';
import { placementOf } from '../../model/layout';
import { useDesignStore } from '../../store/useDesignStore';
import { placeGeometry, viewPlacements, whereOf } from '../panel/panelOps';
import { LEVEL_LABELS, preflightIssues } from '../panel/preflightIssues';
import { PRESET_WIDTH_MM, studioPresets, withStudioPreset } from '../panel/presetOps';
import a11y from '../../../ui/a11y.module.css';
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

/** Сводка для читалки — с задержкой: при перетаскивании не перечитывается на каждый шаг */
const SUMMARY_DELAY_MS = 700;

function useSettled(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const LEVEL_CLS = { serious: styles.serious, warn: styles.warn, info: '' };

/**
 * Проверка макета под холстом: видна, пока двигаешь нанесение. Живой регион —
 * только короткая сводка, список — без `aria-live` (холст озвучивает своё).
 */
function CanvasChecks({ d, item }) {
  const { ctx } = d;
  const placements = useMemo(() => item.prints.map((p) => placementOf(p, ctx.flat)).filter(Boolean), [item.prints, ctx]);
  const issues = useMemo(() => preflightIssues(ctx.flat, placements, d.rules, d.pick.modelChanged), [ctx, placements, d.rules, d.pick.modelChanged]);
  const n = issues.length;
  const summary = n === 0 ? 'Замечаний нет' : `${n} ${pluralize(n, 'замечание', 'замечания', 'замечаний')}`;
  const spoken = useSettled(summary, SUMMARY_DELAY_MS);
  const show = (key) => {
    const pl = placements.find((p) => p.print_key === key);
    const s = useDesignStore.getState();
    // `setView` снимает выбор — сначала вид, потом выбор
    if (pl && pl.view !== d.view) s.setView(pl.view);
    s.select(key);
  };
  return (
    <section className={styles.checks} aria-label="Проверка макета">
      <h3 className={styles.checksTitle}>Проверка макета · <span aria-hidden="true">{summary}</span></h3>
      <p className={a11y.srOnly} role="status">{spoken}</p>
      {n > 0 && (
        <ul className={styles.issues}>
          {issues.map((iss, i) => (
            <li key={`${iss.printKey ?? ''}-${i}`} className={styles.issue}>
              <span className={LEVEL_CLS[iss.level]}>{LEVEL_LABELS[iss.level]}: {iss.message}</span>
              {iss.printKey && <button type="button" className={styles.chipBtn} onClick={() => show(iss.printKey)}>Показать</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Полоса под холстом: проверки (и в только чтении — их видно всем) */
export function StageBelow({ d, item }) {
  if (!d.flat || !d.ctx) return null;
  return (
    <div className={styles.below}>
      <CanvasChecks d={d} item={item} />
    </div>
  );
}

