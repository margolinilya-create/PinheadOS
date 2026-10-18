import { useState } from 'react';
import { VIEW_LABELS } from '../../design/catalog/flatLabels';
import { movePoint, setAnchors, setAreaRect } from '../../design/edit/flatEdit';
import { scaleFromKnownLength } from '../../design/edit/calibrate';
import FlatCanvas from './canvas/FlatCanvas';
import { MmField } from './flatFields';
import { CALIBRATE_HINT, calibrateFlatView, viewOrder, viewTabId } from './flatEditorView';
import styles from './FlatEditor.module.css';

const MODES = [['select', 'Выбор'], ['points', 'Точки'], ['calibrate', 'Калибровка по размеру']];

/** Вкладки видов: стрелки влево и вправо — соседняя вкладка (шаблон WAI tabs) */
function ViewTabs({ kinds, kind, onSelect }) {
  const key = (e, i) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = kinds[(i + d + kinds.length) % kinds.length];
    onSelect(next);
    document.getElementById(viewTabId(next))?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label="Виды флэта">
      {kinds.map((k, i) => (
        <button key={k} type="button" role="tab" id={viewTabId(k)} className={styles.tab}
          aria-selected={k === kind} aria-controls="flat-canvas-panel" tabIndex={k === kind ? 0 : -1}
          onClick={() => onSelect(k)} onKeyDown={(e) => key(e, i)}>
          {VIEW_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

/**
 * Левая колонка редактора: вкладки видов, режимы холста (`aria-pressed`)
 * и холст в sticky-обёртке. Выбор зоны на холсте фокус с холста не уводит.
 * Калибровка: две точки на холсте → поле «Настоящая длина, мм».
 */
export default function FlatCanvasPane({ ctx, view }) {
  const { kind, draft } = ctx;
  const [measured, setMeasured] = useState(null);
  const [real, setReal] = useState(null);
  const vb = ctx.markup.vb;
  const flatMm = vb ? { w: vb.w * view.scale_mm_per_unit, h: vb.h * view.scale_mm_per_unit } : null;

  const apply = () => {
    const s = scaleFromKnownLength(view.scale_mm_per_unit, measured, real);
    if (s) ctx.edit((f) => calibrateFlatView(f, kind, s / view.scale_mm_per_unit));
    setMeasured(null);
    setReal(null);
    ctx.setMode('select');
  };

  return (
    <div className={styles.canvasCol}>
      <ViewTabs kinds={viewOrder(draft)} kind={kind} onSelect={ctx.setKind} />
      <div className={styles.modes} role="group" aria-label="Режим холста">
        {MODES.map(([m, label]) => (
          <button key={m} type="button" className={styles.toggle} aria-pressed={ctx.mode === m} onClick={() => ctx.setMode(m)} disabled={ctx.readOnly}>
            {label}
          </button>
        ))}
      </div>
      {ctx.mode === 'calibrate' && <p className={styles.hint} id="flat-calibrate-hint">{CALIBRATE_HINT}</p>}
      <div className={styles.canvasWrap} role="tabpanel" id="flat-canvas-panel" aria-labelledby={viewTabId(kind)}>
        {ctx.markup.state === 'error' && (
          <div className={styles.inlineNotice} role="alert">
            <p>Силуэт вида не загрузился.</p>
            <button type="button" className="btn" onClick={ctx.markup.retry}>Загрузить снова</button>
          </div>
        )}
        {ctx.markup.state === 'loading' && <p className={styles.hint} role="status">Загружаю силуэт…</p>}
        {flatMm && (
          <FlatCanvas
            markup={ctx.markup.markup}
            flatMm={flatMm}
            view={view}
            accessory={ctx.accessory}
            selectedAreaId={ctx.areaId}
            readOnly={ctx.readOnly}
            mode={ctx.mode}
            onSelectArea={ctx.selectArea}
            onAreaRect={(id, r) => ctx.edit((f) => setAreaRect(f, kind, id, r))}
            onAreaPoint={(id, i, p) => ctx.edit((f) => movePoint(f, kind, id, i, p))}
            onAnchors={(patch) => ctx.edit((f) => setAnchors(f, kind, patch))}
            onMeasured={(mm) => setMeasured(mm)}
            label={`Холст флэта: ${draft.name}, вид ${VIEW_LABELS[kind]}`}
          />
        )}
      </div>
      {measured !== null && (
        <div className={styles.inline} role="group" aria-label="Калибровка по размеру">
          <p className={styles.hint}>{`Отмерено на холсте: ${Math.round(measured * 10) / 10} мм`}</p>
          <MmField id="flat-calibrate-real" label="Настоящая длина, мм" value={real} min={0.1} optional onCommit={setReal} />
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!real}>Применить</button>
          <button type="button" className="btn" onClick={() => { setMeasured(null); ctx.setMode('select'); }}>Отмена</button>
        </div>
      )}
    </div>
  );
}
