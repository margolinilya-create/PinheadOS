import { useState } from 'react';
import { downloadFlatSvg } from '../../api/garmentFlats';
import { GARMENT_TYPE_CATEGORY, isAccessoryType } from '../../design/catalog/categoryMap';
import { GARMENT_TYPE_LABELS, VIEW_LABELS } from '../../design/catalog/flatLabels';
import { defaultAreas } from '../../design/edit/flatAreas';
import { emptyFlat } from '../../design/edit/flatEdit';
import { idError, suggestFlatId } from '../../design/edit/flatIds';
import { removedText } from '../../design/edit/newFlat';
import { resolveFlat } from '../../design/export/resolveFlat';
import { FLAT_VIEW_KINDS, GARMENT_TYPES } from '../../design/types';
import ModelPicker from './ModelPicker';
import { Field } from './flatFields';
import { readSvgFile } from './flatFile';
import { exactCopy, fieldAria, flatFieldId, removedSummary, typeOfCategory } from './flatEditorView';
import base from '../../screens/Sales.module.css';
import styles from './FlatEditor.module.css';

/** Тексты всех видов прежнего флэта свежим скачиванием (как перенос К2); сбой — `null` */
async function copyTexts(src) {
  const out = {};
  for (const v of src.views) {
    const text = await downloadFlatSvg(v.svg_path);
    const clean = text ? resolveFlat(text, v)?.markup : null;
    if (!clean) return { error: `Не удалось скачать вид «${VIEW_LABELS[v.kind]}» — попробуйте ещё раз` };
    out[v.kind] = clean;
  }
  return { files: out };
}

/**
 * Новый флэт: SVG первого вида, имя, id (предлагается из имени, правится),
 * тип (из первой выбранной модели, пока его не выбрали руками), модели.
 * Зоны вида — по умолчанию (решение 21). Режим «Сделать точный силуэт для
 * модели» (`copyFrom`): новые имя и id, файлы — все виды прежнего флэта.
 */
export default function NewFlatForm({ reservedIds, zones, skus, copyFrom, onReady }) {
  const [svg, setSvg] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [kind, setKind] = useState('front');
  const [name, setName] = useState(copyFrom ? `${copyFrom.name} — точный` : '');
  const [ownId, setOwnId] = useState(null);
  const [ownType, setOwnType] = useState(null);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const id = ownId ?? suggestFlatId(name, reservedIds);
  const idErr = name.trim() || ownId ? idError(id, reservedIds) : null;
  const modelType = typeOfCategory(skus.find((s) => s.code === models[0])?.category);
  const type = ownType ?? modelType ?? copyFrom?.garment_type ?? 'tshirt';
  const ready = !!name.trim() && !idErr && (copyFrom || svg?.ok);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const res = await readSvgFile(file);
    setSvg(res.ok ? res : null);
    setFileError(res.ok ? null : res.error);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    if (copyFrom) {
      setBusy(true);
      const res = await copyTexts(copyFrom);
      setBusy(false);
      if (res.error) return setFileError(res.error);
      return onReady(exactCopy(copyFrom, id, name.trim()), res.files, {});
    }
    const flatMm = { w: svg.vb.w * svg.scale, h: svg.vb.h * svg.scale };
    const draft = emptyFlat(id, name.trim(), type, kind, {
      scale_mm_per_unit: svg.scale, flatMm, accessory: isAccessoryType(type), areas: defaultAreas(kind, type, flatMm, zones),
    });
    const typical = models.length === 0;
    return onReady({ ...draft, typical, sku_codes: models, categories: typical ? [GARMENT_TYPE_CATEGORY[type]] : [] }, { [kind]: svg.svg }, { [kind]: svg.removed });
  };

  return (
    <form className={styles.newForm} onSubmit={submit} aria-labelledby="flat-new-head">
      <h3 id="flat-new-head" className={styles.sectionHead}>
        {copyFrom ? `Точный силуэт из «${copyFrom.name}»` : 'Новый флэт из SVG'}
      </h3>
      {copyFrom ? (
        <p className={styles.hint}>Виды, зоны и якоря скопируются; модели выберите после создания. Прежний флэт не меняется</p>
      ) : (
        <>
          <label className={base.field} htmlFor="flat-new-file">
            SVG первого вида
            <input id="flat-new-file" type="file" accept=".svg,image/svg+xml" onChange={pick} autoFocus
              aria-invalid={fileError ? true : undefined} aria-describedby={fileError ? 'flat-new-file-err' : undefined} />
          </label>
          <label className={base.field} htmlFor="flat-new-kind">
            Какой это вид
            <select id="flat-new-kind" className={base.select} value={kind} onChange={(e) => setKind(e.target.value)}>
              {FLAT_VIEW_KINDS.map((k) => <option key={k} value={k}>{VIEW_LABELS[k]}</option>)}
            </select>
          </label>
          {svg?.removed.length > 0 && (
            <div className={styles.removed}>
              <p>Из файла убрано:</p>
              <ul>{svg.removed.map((r) => <li key={r.label}>{removedText(r)}</li>)}</ul>
            </div>
          )}
          <p className={styles.srOnly} aria-live="polite">{svg ? removedSummary(svg.removed) : ''}</p>
        </>
      )}
      {fileError && <p id="flat-new-file-err" className={styles.fieldError} role="alert">{fileError}</p>}

      <label className={base.field} htmlFor={flatFieldId('name')}>
        Название флэта
        <input id={flatFieldId('name')} className={base.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!copyFrom} />
      </label>
      <Field id={flatFieldId('id')} label="id флэта" hint="Латиница, цифры и дефис; после создания не меняется" errors={idErr ? [idErr] : null}>
        <input {...fieldAria(flatFieldId('id'), idErr ? [idErr] : null, true)} className={base.input} value={id} onChange={(e) => setOwnId(e.target.value)} />
      </Field>
      {!copyFrom && (
        <>
          <label className={base.field} htmlFor={flatFieldId('garment_type')}>
            Тип изделия
            <select id={flatFieldId('garment_type')} className={base.select} value={type} onChange={(e) => setOwnType(e.target.value)}>
              {GARMENT_TYPES.map((t) => <option key={t} value={t}>{GARMENT_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <ModelPicker id={flatFieldId('sku_codes')} label="Модели (пусто — типовой силуэт)" skus={skus} value={models} onChange={setModels} />
        </>
      )}
      <button type="submit" className="btn btn-primary" disabled={!ready || busy} aria-busy={busy || undefined}>
        {copyFrom ? 'Подготовить точный силуэт' : 'Подготовить флэт'}
      </button>
    </form>
  );
}
