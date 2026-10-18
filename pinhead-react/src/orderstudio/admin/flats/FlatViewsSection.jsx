import { useState } from 'react';
import { VIEW_LABELS } from '../../design/catalog/flatLabels';
import { removedText } from '../../design/edit/newFlat';
import { MAX_SCALE_MM_PER_UNIT } from '../../design/limits';
import { FLAT_VIEW_KINDS } from '../../design/types';
import { DesignIcon } from '../../design/ui/DesignIcon';
import AnchorFields from './AnchorFields';
import { FieldErrors, MmField } from './flatFields';
import {
  calibrateFlatView, errorsAt, GEOMETRY_HINT, GRADE_TEXT, mirrorButtonLabel, NO_SLEEVES_TEXT,
  removedSummary, silhouetteWidth, viewFieldId,
} from './flatEditorView';
import base from '../../screens/Sales.module.css';
import styles from './FlatEditor.module.css';

const isSleeve = (k) => k === 'sleeve_left' || k === 'sleeve_right';

/** Поле выбора SVG: отказ — текстом под полем */
function SvgInput({ id, label, onFile }) {
  const [error, setError] = useState(null);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(await onFile(file));
  };
  return (
    <div className={base.field}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="file" accept=".svg,image/svg+xml" onChange={pick}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} />
      {error && <span id={`${id}-err`} className={styles.fieldError} role="alert">{error}</span>}
    </div>
  );
}

/**
 * Вкладка «Вид»: файл, ширина силуэта (основное поле) и масштаб под «Подробно»,
 * калибровка, якоря, зеркальный рукав, удаление и добавление вида.
 */
export default function FlatViewsSection({ ctx, view }) {
  const { kind, draft } = ctx;
  const [addKind, setAddKind] = useState(null);
  const missing = FLAT_VIEW_KINDS.filter((k) => !draft.views.some((v) => v.kind === k));
  const chosen = addKind && missing.includes(addKind) ? addKind : missing[0];
  const vbW = ctx.vb?.w;
  const width = vbW ? silhouetteWidth(vbW, view.scale_mm_per_unit) : null;
  const removed = ctx.removed[kind] ?? [];
  const calibrate = (k) => ctx.edit((f) => calibrateFlatView(f, kind, k));
  const scaleErr = errorsAt(ctx.errors, kind, undefined, 'scale_mm_per_unit');

  return (
    <section className={styles.section} aria-labelledby="flat-view-head">
      <h3 id="flat-view-head" className={styles.sectionHead}>{`Вид «${VIEW_LABELS[kind]}»`}</h3>
      <p className={styles.geoHint}>{GEOMETRY_HINT}</p>
      <SvgInput id={viewFieldId(kind, 'svg_path')} label={`Заменить SVG вида «${VIEW_LABELS[kind]}»`} onFile={(f) => ctx.actions.replaceFile(kind, f)} />
      {removed.length > 0 && (
        <div className={styles.removed}>
          <p>Из файла убрано:</p>
          <ul>{removed.map((r) => <li key={r.label}>{removedText(r)}</li>)}</ul>
        </div>
      )}
      <p className={styles.srOnly} aria-live="polite">{removedSummary(removed)}</p>

      <MmField
        id={`${viewFieldId(kind, 'scale_mm_per_unit')}-w`}
        label="Ширина силуэта, мм"
        value={width}
        min={1}
        disabled={!width}
        hint={width ? 'Все зоны и якоря вида растянутся вместе с силуэтом' : 'Ширина появится, когда загрузится силуэт'}
        onCommit={(w) => width && calibrate(w / width)}
      />
      <button type="button" className="btn" aria-pressed={ctx.mode === 'calibrate'} onClick={() => ctx.setMode('calibrate')}>
        <DesignIcon name="ruler" />
        Калибровать по размеру
      </button>
      <details className={styles.details}>
        <summary>Подробно</summary>
        <MmField id={viewFieldId(kind, 'scale_mm_per_unit')} label="Масштаб, мм на единицу SVG" value={view.scale_mm_per_unit}
          min={0.0001} max={MAX_SCALE_MM_PER_UNIT} errors={scaleErr} onCommit={(s) => calibrate(s / view.scale_mm_per_unit)} />
      </details>

      <AnchorFields ctx={ctx} view={view} />
      {(view.grade_rule || view.size_anchors) && <p className={styles.hint}>{GRADE_TEXT}</p>}

      {isSleeve(kind) && (
        <button type="button" className="btn" onClick={(e) => ctx.actions.mirror(kind, e.currentTarget)}>
          {mirrorButtonLabel(kind)}
        </button>
      )}
      <button
        type="button"
        className="btn"
        aria-label={`Удалить вид «${VIEW_LABELS[kind]}»`}
        disabled={draft.views.length <= 1}
        onClick={(e) => ctx.actions.dropView(kind, e.currentTarget)}
      >
        <DesignIcon name="trash" />
        Удалить вид
      </button>

      {missing.length > 0 && (
        <fieldset className={styles.group}>
          <legend>Добавить вид</legend>
          {!draft.views.some((v) => isSleeve(v.kind)) && <p className={styles.hint}>{NO_SLEEVES_TEXT}</p>}
          <label className={base.field} htmlFor="flat-add-view-kind">
            Какой вид
            <select id="flat-add-view-kind" className={base.select} value={chosen} onChange={(e) => setAddKind(e.target.value)}>
              {missing.map((k) => <option key={k} value={k}>{VIEW_LABELS[k]}</option>)}
            </select>
          </label>
          <SvgInput id="flat-add-view-file" label={`SVG вида «${VIEW_LABELS[chosen]}»`} onFile={(f) => ctx.actions.addViewFrom(chosen, f)} />
        </fieldset>
      )}
      <FieldErrors id={viewFieldId(kind, 'svg_path')} errors={errorsAt(ctx.errors, kind, undefined, 'svg_path')} />
    </section>
  );
}
