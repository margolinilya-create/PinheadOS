import { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SKU_CATEGORIES } from '../../data/skuCatalog';
import { materialPrice } from '../../utils/costRules';
import base from '../../orderstudio/screens/Sales.module.css';
import ExpressField from './express/ExpressField';
import ExpressZones from './express/ExpressZones';
import ExpressExtras from './express/ExpressExtras';
import ExpressTotals from './express/ExpressTotals';
import { initZoneData, quote, toggleZone, withTech, zonesOf } from './express/expressModel';
import s from './ExpressCalc.module.css';

/**
 * Экспресс-расчёт `/express` — прикидка цены изделия с нанесением за минуту,
 * без заказа (веха 8, задача 4: на примитивах ERP `Button` и `EmptyState`, без
 * глобального `express.css`; шапка и поля — общими классами раздела `Sales.module.css`,
 * почему не `PageHead`/`Field` — `express/ExpressField.jsx`).
 * Формула и данные — `express/expressModel.ts`; суммы до и после рестайла равны.
 * Бирок здесь нет и не добавляется (К9): цена бирок v4 — по библиотеке.
 */
const CAT_NAMES = Object.fromEntries(SKU_CATEGORIES.map((c) => [c.id, c.name]));

function fabricLabel(f, usdRate) {
  const density = f.density ? ` ${f.density} г` : '';
  const composition = f.composition ? ` (${f.composition})` : '';
  return `${f.name}${density}${composition} — ${Math.round(materialPrice(f, usdRate) || 0)} ₽/м · ${f.supplier}`;
}

export default function ExpressCalc() {
  const { skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, usdRate } = useStore(
    useShallow((st) => ({
      skuCatalog: st.skuCatalog, fabricsCatalog: st.fabricsCatalog, trimCatalog: st.trimCatalog,
      extrasCatalog: st.extrasCatalog, usdRate: st.usdRate,
    })),
  );

  const [skuCode, setSkuCode] = useState('');
  const [fabricCode, setFabricCode] = useState('');
  const [qty, setQty] = useState(100);
  const [zoneData, setZoneData] = useState({});
  const [selectedExtras, setSelectedExtras] = useState([]);

  const categories = useMemo(() => {
    const cats = {};
    for (const item of skuCatalog) (cats[item.category] ||= []).push(item);
    return cats;
  }, [skuCatalog]);

  const sku = useMemo(() => skuCatalog.find((x) => x.code === skuCode) || null, [skuCode, skuCatalog]);
  const fabric = useMemo(() => fabricsCatalog.find((f) => f.code === fabricCode) || null, [fabricCode, fabricsCatalog]);
  const fabrics = useMemo(() => (sku
    ? fabricsCatalog.filter((f) => !f.forCategories?.length || f.forCategories.includes(sku.category))
    : fabricsCatalog), [sku, fabricsCatalog]);
  const zones = useMemo(() => zonesOf(sku), [sku]);
  const extras = useMemo(() => (sku
    ? extrasCatalog.filter((e) => !e.forCategories?.length || e.forCategories.includes(sku.category))
    : []), [sku, extrasCatalog]);

  const calc = useMemo(() => (sku ? quote({
    sku, fabric, qty, zones: zoneData, extras: selectedExtras, fabricsCatalog, trimCatalog, extrasCatalog, usdRate,
  }) : null), [sku, fabric, qty, zoneData, selectedExtras, fabricsCatalog, trimCatalog, extrasCatalog, usdRate]);

  const changeSku = (code) => {
    setSkuCode(code);
    setFabricCode('');
    setSelectedExtras([]);
    setZoneData(initZoneData(zonesOf(skuCatalog.find((x) => x.code === code) || null)));
  };
  const toggleExtra = (code) => setSelectedExtras((prev) => (
    prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  const setTech = (id, tech) => setZoneData((prev) => ({ ...prev, [id]: withTech(prev[id], tech) }));
  const setParam = (id, key, val) => setZoneData((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));

  const catalogEmpty = Object.keys(categories).length === 0;

  return (
    <div className={base.page}>
      <div className={base.head}>
        <div>
          <h1 className={base.title}>Экспресс-расчёт</h1>
          <p className={base.sub}>Прикидка цены изделия с нанесением — без заказа</p>
        </div>
      </div>
      <div className={s.grid}>
        <div className={s.form}>
          <ExpressField as="select" label="Изделие" value={skuCode} onChange={(e) => changeSku(e.target.value)}>
            <option value="">— Выберите —</option>
            {catalogEmpty && <option disabled>Каталог загружается…</option>}
            {Object.entries(categories).map(([cat, items]) => (
              <optgroup key={cat} label={CAT_NAMES[cat] || cat}>
                {items.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </optgroup>
            ))}
          </ExpressField>

          <ExpressField
            as="select"
            label="Ткань"
            value={fabricCode}
            hint={sku && !fabric ? 'Без ткани показана базовая цена пошива' : undefined}
            onChange={(e) => setFabricCode(e.target.value)}
          >
            <option value="">— Выберите —</option>
            {fabrics.map((f) => <option key={f.code} value={f.code}>{fabricLabel(f, usdRate)}</option>)}
          </ExpressField>

          <ExpressField
            type="number"
            inputMode="numeric"
            min="1"
            label="Тираж, шт"
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />

          {sku && (
            <ExpressZones
              zones={zones}
              data={zoneData}
              qty={qty}
              fabricCode={fabric?.code}
              onToggle={(id) => setZoneData((prev) => toggleZone(prev, id))}
              onTech={setTech}
              onParam={setParam}
            />
          )}

          {sku && extras.length > 0 && (
            <ExpressExtras extras={extras} selected={selectedExtras} total={calc?.extrasCost || 0} onToggle={toggleExtra} />
          )}
        </div>

        <ExpressTotals calc={calc} qty={qty} />
      </div>
    </div>
  );
}
