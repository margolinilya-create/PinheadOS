import { useState } from 'react';
import { getAvailableZonesForSku } from '../../../utils/skuRules';
import { TZ_ROW_CODES, TZ_ROW_LABELS, tzRowOfZone } from '../../catalog/tzRows';
import { areaRect, isRectArea, setAreaRect, updateArea } from '../../design/edit/flatEdit';
import { METHOD_LABELS, METHOD_ORDER } from '../../model/printMethods';
import AreaPoints from './AreaPoints';
import { Field, MmField } from './flatFields';
import { areaFieldId, errorsAt, fieldAria, GEOMETRY_HINT } from './flatEditorView';
import base from '../../screens/Sales.module.css';
import styles from './FlatEditor.module.css';

/** Пометки зоны справочника в списке выбора */
function zoneOptionLabel(zone, categories, zones) {
  const off = zone.active === false ? ' (снята)' : '';
  const foreign = categories.length > 0 && zone.active !== false
    && !categories.some((c) => getAvailableZonesForSku(zones, c).some((z) => z.id === zone.id));
  return `${zone.name}${off}${foreign ? ' — не для категорий этого флэта' : ''}`;
}

function Limits({ ctx, kind, area, field, label }) {
  const v = area[field];
  const set = (axis, n) => {
    if (n === null) return ctx.edit((f) => updateArea(f, kind, area.id, { [field]: undefined }));
    const next = { width: v?.width ?? n, height: v?.height ?? n, [axis]: n };
    return ctx.edit((f) => updateArea(f, kind, area.id, { [field]: next }));
  };
  const id = areaFieldId(kind, area.id, field);
  return (
    <div className={styles.pair} role="group" aria-label={label}>
      <MmField id={id} label={`${label}: ширина, мм`} value={v?.width ?? null} optional onCommit={(n) => set('width', n)} errors={errorsAt(ctx.errors, kind, area.id, field)} />
      <MmField id={`${id}-h`} label={`${label}: высота, мм`} value={v?.height ?? null} optional onCommit={(n) => set('height', n)} />
    </div>
  );
}

/**
 * Поля выбранной зоны флэта: название (у сохранённой служебной зоны — только
 * чтение: оно ключ нанесений), зона из справочника, строка ТЗ, рамка или точки,
 * отступ, техники и лимиты печати. Поля геометрии подписаны «Меняет силуэт».
 */
export default function AreaFields({ ctx, kind, area }) {
  const [poly, setPoly] = useState(() => !isRectArea(area));
  const zones = ctx.zones ?? [];
  const zone = zones.find((z) => z.id === area.zone_id);
  const was = ctx.base?.views.find((v) => v.kind === kind)?.print_areas.find((a) => a.id === area.id);
  const nameLocked = !!was && was.zone_id === null && area.zone_id === null;
  const err = (field) => errorsAt(ctx.errors, kind, area.id, field);
  const id = (field) => areaFieldId(kind, area.id, field);
  const patch = (p) => ctx.edit((f) => updateArea(f, kind, area.id, p));
  const rect = areaRect(area);
  const setRect = (k, v) => ctx.edit((f) => setAreaRect(f, kind, area.id, { ...rect, [k]: v }));
  const methods = area.methods ?? [];
  const toggleMethod = (m) => {
    const next = methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m];
    patch({ methods: next.length ? METHOD_ORDER.filter((x) => next.includes(x)) : undefined });
  };
  const defaultChoices = methods.length ? methods : METHOD_ORDER;
  const NAME_LOCKED = 'Название служебной зоны — ключ нанесений в заказах, его не меняют';

  return (
    <div className={styles.areaFields}>
      <Field id={id('name')} label="Название" hint={nameLocked ? NAME_LOCKED : null} errors={err('name')}>
        <input
          {...fieldAria(id('name'), err('name'), nameLocked)}
          className={base.input}
          value={area.name}
          readOnly={nameLocked}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>

      <Field id={id('zone_id')} label="Зона из справочника" hint={GEOMETRY_HINT} errors={err('zone_id')}>
        <select {...fieldAria(id('zone_id'), err('zone_id'), true)} className={base.select} value={area.zone_id ?? ''} onChange={(e) => patch({ zone_id: e.target.value || null })}>
          <option value="">Служебная — без зоны справочника</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{zoneOptionLabel(z, ctx.draft.categories, zones)}</option>)}
        </select>
      </Field>

      <Field id={id('tz_row')} label="Строка ТЗ" errors={err('tz_row')}>
        <select {...fieldAria(id('tz_row'), err('tz_row'))} className={base.select} value={area.tz_row ?? ''} onChange={(e) => patch({ tz_row: e.target.value || undefined })}>
          <option value="">{`По умолчанию: ${TZ_ROW_LABELS[area.zone_id === null ? 'other' : tzRowOfZone(zone ?? { id: area.zone_id })]}`}</option>
          {TZ_ROW_CODES.map((c) => <option key={c} value={c}>{TZ_ROW_LABELS[c]}</option>)}
        </select>
      </Field>

      <fieldset className={styles.group}>
        <legend>{poly ? 'Точки зоны' : 'Рамка зоны'}</legend>
        <p className={styles.geoHint}>{GEOMETRY_HINT}</p>
        {poly ? (
          <>
            <AreaPoints ctx={ctx} kind={kind} area={area} errors={err('polygon_mm')} />
            <p className={styles.hint}>На холсте заказа логотип проверяется по описывающему прямоугольнику зоны</p>
            <button type="button" className="btn" onClick={() => { setRect('x', rect.x); setPoly(false); }}>Сделать прямоугольником</button>
          </>
        ) : (
          <>
            <div className={styles.quad}>
              <MmField id={id('polygon_mm')} label="X, мм" value={rect.x} onCommit={(v) => setRect('x', v)} errors={err('polygon_mm')} />
              <MmField id={`${id('polygon_mm')}-y`} label="Y, мм" value={rect.y} onCommit={(v) => setRect('y', v)} />
              <MmField id={`${id('polygon_mm')}-w`} label="Ш, мм" value={rect.w} min={0.1} onCommit={(v) => setRect('w', v)} />
              <MmField id={`${id('polygon_mm')}-h`} label="В, мм" value={rect.h} min={0.1} onCommit={(v) => setRect('h', v)} />
            </div>
            <button type="button" className="btn" onClick={() => setPoly(true)}>Многоугольник</button>
          </>
        )}
      </fieldset>

      <MmField id={id('safe_inset_mm')} label="Отступ от края зоны, мм" value={area.safe_inset_mm} onCommit={(v) => patch({ safe_inset_mm: v })} errors={err('safe_inset_mm')} />

      <fieldset className={styles.group} id={id('methods')} tabIndex={-1}>
        <legend>Техники</legend>
        <p className={styles.hint}>Ничего не отмечено — все. Итог — пересечение с правилами категорий</p>
        <div className={styles.checks}>
          {METHOD_ORDER.map((m) => (
            <label key={m} className={styles.checkLabel}>
              <input type="checkbox" checked={methods.includes(m)} onChange={() => toggleMethod(m)} />
              {METHOD_LABELS[m]}
            </label>
          ))}
        </div>
        {err('methods').length > 0 && <p className={styles.fieldError}>{err('methods').join('; ')}</p>}
      </fieldset>

      <Field id={id('default_method')} label="Техника по умолчанию" errors={err('default_method')}>
        <select {...fieldAria(id('default_method'), err('default_method'))} className={base.select} value={area.default_method ?? ''} onChange={(e) => patch({ default_method: e.target.value || undefined })}>
          <option value="">Не задана</option>
          {defaultChoices.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
        </select>
      </Field>

      <Limits ctx={ctx} kind={kind} area={area} field="max_print_mm" label="Наибольший отпечаток" />
      <Limits ctx={ctx} kind={kind} area={area} field="min_print_mm" label="Наименьший отпечаток" />
    </div>
  );
}
