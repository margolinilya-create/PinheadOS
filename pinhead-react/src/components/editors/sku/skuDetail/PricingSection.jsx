import { useMemo } from 'react';
import { skuCost } from '../../../../utils/costRules';
import { getEffectiveRules } from '../../../../utils/skuRules';
import { TECH_TABS } from '../../../../utils/pricing';
import { SIZES } from '../../../../data';
import t from '../skuTable.module.css';
import m from '../SkuModal.module.css';

/** Себестоимость модели — та же функция, что в визарде (правка 13.10) */
function Economics({ sku, fabricsCatalog, trimCatalog, usdRate }) {
  const e = useMemo(() => {
    const c = skuCost(sku, { fabricCode: null, fabricsCatalog, trimCatalog, usdRate });
    const fabric = fabricsCatalog.find((f) => f.code === c.fabricCode);
    const trim = trimCatalog.find((x) => x.code === c.trimCode);
    return {
      sewing: c.sewing, fabric: Math.round(c.fabric), trim: Math.round(c.trim), extra: c.extraMaterials,
      fabricName: fabric ? [fabric.name, fabric.supplier].filter(Boolean).join(' · ') : '—',
      trimName: trim?.name || '—', total: Math.round(c.base),
    };
  }, [sku, fabricsCatalog, trimCatalog, usdRate]);
  return (
    <section className={m.section} aria-labelledby="sku-detail-econ">
      <h3 id="sku-detail-econ" className={m.sectionHead}>Себестоимость</h3>
      <dl className={m.econ}>
        <dt>Пошив</dt><dd>{e.sewing} ₽</dd>
        <dt>Ткань ({e.fabricName})</dt><dd>{e.fabric} ₽</dd>
        <dt>Отделка ({e.trimName})</dt><dd>{e.trim} ₽</dd>
        {e.extra > 0 && <><dt>Доп. материалы</dt><dd>{e.extra} ₽</dd></>}
        <dt className={m.econTotal}>Итого</dt><dd className={m.econTotal}>{e.total} ₽</dd>
      </dl>
    </section>
  );
}

/**
 * Себестоимость и переопределения правил категории для модели: техники, MOQ,
 * множитель цены, размеры. Серым («от категории») — унаследованное.
 */
export default function PricingSection({ sku, skuIndex, onUpdate, categoryRules, fabricsCatalog, trimCatalog, usdRate, children }) {
  const rules = useMemo(() => getEffectiveRules(sku, categoryRules || []), [sku, categoryRules]);
  const overrides = sku.overrides || {};
  const setOverrides = (next) => onUpdate(skuIndex, 'overrides', Object.keys(next).length > 0 ? next : undefined);
  const clear = (field) => {
    const next = { ...overrides };
    delete next[field];
    setOverrides(next);
  };

  const toggleTech = (key) => {
    const current = overrides.allowedTechs || rules.allowedTechs || TECH_TABS.map((x) => x.key);
    const next = current.includes(key) ? current.filter((x) => x !== key) : [...current, key];
    onUpdate(skuIndex, 'overrides', { ...overrides, allowedTechs: next });
  };
  const setMoq = (v) => onUpdate(skuIndex, 'overrides', { ...overrides, moq: Math.max(1, Number(v) || 1) });
  const setMultiplier = (v) => {
    const num = Number(v);
    if (isNaN(num) || num < 0) return;
    onUpdate(skuIndex, 'priceMultiplier', num || undefined);
  };
  const toggleSize = (s) => {
    const current = sku.availableSizes || [...SIZES];
    const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s];
    onUpdate(skuIndex, 'availableSizes', next.length === SIZES.length ? undefined : next);
  };

  const techOverride = overrides.allowedTechs !== undefined;
  const mult = sku.priceMultiplier;

  return (
    <>
      <Economics sku={sku} fabricsCatalog={fabricsCatalog} trimCatalog={trimCatalog} usdRate={usdRate} />
      <section className={m.section} aria-labelledby="sku-detail-overrides">
        <h3 id="sku-detail-overrides" className={m.sectionHead}>Правила модели</h3>
        <p className={m.hint}>Без отметки «своё» действуют правила категории. Правка здесь — только для этой модели.</p>

        <div className={m.row} role="group" aria-label="Техники нанесения модели">
          <span className={m.rowLabel}>Техники{techOverride ? '' : ' (от категории)'}</span>
          {TECH_TABS.map((x) => {
            const on = techOverride ? overrides.allowedTechs.includes(x.key) : (!rules.allowedTechs || rules.allowedTechs.includes(x.key));
            return (
              <button key={x.key} type="button" className={t.chip} aria-pressed={on} onClick={() => toggleTech(x.key)}>{x.label}</button>
            );
          })}
          {techOverride && <button type="button" className={t.chip} onClick={() => clear('allowedTechs')}>Сбросить</button>}
        </div>

        <div className={m.row}>
          <label htmlFor="sku-detail-moq" className={m.rowLabel}>Минимальный тираж</label>
          <input id="sku-detail-moq" type="number" min="1" className={m.numInput}
            value={overrides.moq ?? rules.moq} onChange={(e) => setMoq(e.target.value)} />
          {overrides.moq !== undefined
            ? <button type="button" className={t.chip} onClick={() => clear('moq')}>Сбросить</button>
            : rules.moq > 1 && <span className={m.inherited}>от категории</span>}
        </div>

        <div className={m.row}>
          <label htmlFor="sku-detail-mult" className={m.rowLabel}>Множитель цены</label>
          <input id="sku-detail-mult" type="number" step="0.1" min="0" className={m.numInput}
            value={mult ?? 1} onChange={(e) => setMultiplier(e.target.value)} />
          {mult && mult !== 1 && (
            <span className={m.badge}>{mult > 1 ? '+' : ''}{Math.round((mult - 1) * 100)}%</span>
          )}
        </div>

        {children}

        <div className={m.row}>
          <span className={m.rowLabel}>Размеры{sku.availableSizes ? '' : ' (от категории)'}</span>
          <div className={m.checks} role="group" aria-label="Размеры модели">
            {SIZES.map((s) => (
              <label key={s} className={m.check}>
                <input type="checkbox" checked={!sku.availableSizes || sku.availableSizes.includes(s)} onChange={() => toggleSize(s)} />
                <span>{s}</span>
              </label>
            ))}
          </div>
          {sku.availableSizes && (
            <button type="button" className={t.chip} onClick={() => onUpdate(skuIndex, 'availableSizes', undefined)}>Сбросить</button>
          )}
        </div>
      </section>
    </>
  );
}
