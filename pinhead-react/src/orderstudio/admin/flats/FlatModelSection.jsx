import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { GARMENT_TYPE_LABELS } from '../../design/catalog/flatLabels';
import { updateMeta } from '../../design/edit/flatEdit';
import { addSize, removeSize, setBaseSize } from '../../design/edit/flatSizes';
import { GARMENT_TYPES } from '../../design/types';
import { FlatIcon } from './FlatIcon';
import ModelPicker from './ModelPicker';
import { Field, FieldErrors } from './flatFields';
import { ACTIVE_HINT, errorsAt, errorTextId, fieldAria, flatFieldId, OFF_TEXT } from './flatEditorView';
import base from '../../screens/Sales.module.css';
import styles from './FlatEditor.module.css';

const FITS = [['regular', 'Regular'], ['oversize', 'Oversize'], ['free', 'Free'], ['classic', 'Classic']];

function Toggles({ label, options, value, onChange }) {
  const flip = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className={styles.chipsRow} role="group" aria-label={label}>
      <span className={styles.groupLabel} aria-hidden="true">{label}</span>
      {options.map(([id, name]) => (
        <button key={id} type="button" className={styles.toggle} aria-pressed={value.includes(id)} onClick={() => flip(id)}>{name}</button>
      ))}
    </div>
  );
}

/**
 * Вкладка «Модель и подбор»: метаданные флэта — правка без новой версии (К6).
 * Имя, тип, «Силуэт: типовой / точный», «Предлагать для новых позиций»,
 * модели, категории, посадки, размеры; «Сделать точный силуэт для модели».
 */
export default function FlatModelSection({ ctx }) {
  const { draft } = ctx;
  const [size, setSize] = useState('');
  const meta = (p) => ctx.edit((f) => updateMeta(f, p));
  const err = (field) => errorsAt(ctx.errors, undefined, undefined, field);
  const described = (field) => (err(field).length ? errorTextId(flatFieldId(field)) : undefined);
  const addOne = () => {
    ctx.edit((f) => addSize(f, size));
    setSize('');
  };

  return (
    <section className={styles.section} aria-labelledby="flat-model-head">
      <h3 id="flat-model-head" className={styles.sectionHead}>Модель и подбор</h3>
      <Field id={flatFieldId('name')} label="Название флэта" errors={err('name')}>
        <input {...fieldAria(flatFieldId('name'), err('name'))} className={base.input} value={draft.name} onChange={(e) => meta({ name: e.target.value })} />
      </Field>
      <Field id={flatFieldId('garment_type')} label="Тип изделия" errors={err('garment_type')}>
        <select {...fieldAria(flatFieldId('garment_type'), err('garment_type'))} className={base.select} value={draft.garment_type} onChange={(e) => meta({ garment_type: e.target.value })}>
          {!GARMENT_TYPES.includes(draft.garment_type) && <option value={draft.garment_type}>{`Неизвестный тип: ${draft.garment_type}`}</option>}
          {GARMENT_TYPES.map((t) => <option key={t} value={t}>{GARMENT_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>

      <fieldset className={styles.group} id={flatFieldId('typical')} tabIndex={-1}>
        <legend>Силуэт</legend>
        <label className={styles.checkLabel}>
          <input type="radio" name="flat-typical" checked={draft.typical} onChange={() => meta({ typical: true })} />
          Типовой для вида изделия
        </label>
        <label className={styles.checkLabel}>
          <input type="radio" name="flat-typical" checked={!draft.typical} onChange={() => meta({ typical: false })} />
          Точный для выбранных моделей
        </label>
      </fieldset>

      <label className={styles.checkLabel} htmlFor={flatFieldId('active')}>
        <input id={flatFieldId('active')} type="checkbox" checked={draft.active} onChange={(e) => meta({ active: e.target.checked })} aria-describedby="flat-active-hint" />
        Предлагать для новых позиций
      </label>
      <p id="flat-active-hint" className={styles.hint}>{draft.active ? ACTIVE_HINT : OFF_TEXT}</p>

      <ModelPicker id={flatFieldId('sku_codes')} label="Модели" skus={ctx.skus} value={draft.sku_codes}
        onChange={(codes) => meta({ sku_codes: codes })} describedBy={described('sku_codes')} />
      <FieldErrors id={flatFieldId('sku_codes')} errors={err('sku_codes')} />

      <Toggles label="Категории" options={SKU_CATEGORIES.map((c) => [c.id, c.name])} value={draft.categories} onChange={(v) => meta({ categories: v })} />
      <Toggles label="Посадки (пусто — любая)" options={FITS} value={draft.fits} onChange={(v) => meta({ fits: v })} />

      <fieldset className={styles.group} id={flatFieldId('sizes')} tabIndex={-1}>
        <legend>Размеры</legend>
        <ul className={styles.chips} aria-label="Размеры флэта">
          {draft.sizes.map((s) => (
            <li key={s} className={styles.chip}>
              {s}
              {s === draft.base_size ? <span className={styles.tag}>базовый</span> : (
                <button type="button" className={styles.chipX} aria-label={`Удалить размер ${s}`} onClick={() => ctx.edit((f) => removeSize(f, s))}>
                  <FlatIcon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className={styles.inline}>
          <label className={base.field} htmlFor="flat-size-add">
            Новый размер
            <input id="flat-size-add" className={base.input} value={size} onChange={(e) => setSize(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addOne(); }} />
          </label>
          <button type="button" className="btn" onClick={addOne} disabled={!size.trim()}>Добавить размер</button>
        </div>
        {draft.sizes.length > 0 && (
          <label className={base.field} htmlFor={flatFieldId('base_size')}>
            Базовый размер
            <select id={flatFieldId('base_size')} className={base.select} value={draft.base_size} onChange={(e) => ctx.edit((f) => setBaseSize(f, e.target.value))}>
              {draft.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </fieldset>

      {ctx.onMakeExact && (
        <button type="button" className="btn" onClick={ctx.onMakeExact}>Сделать точный силуэт для модели</button>
      )}
    </section>
  );
}
