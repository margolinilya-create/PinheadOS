import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES, TECH_NAMES } from '../../data';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { PRICES } from '../../data/prices';

function getTier(tiers, qty) {
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i]) return i;
  }
  return 0;
}

export default function ExpressCalc({ onClose }) {
  const usdRate = useStore(s => s.usdRate);
  const [skuCode, setSkuCode] = useState('');
  const [fabricCode, setFabricCode] = useState('');
  const [qty, setQty] = useState(100);
  const [tech, setTech] = useState('screen');
  const [format, setFormat] = useState('A4');
  const [colors, setColors] = useState(1);

  const sku = SKU_CATALOG_DEFAULT.find(s => s.code === skuCode);
  const fabric = FABRICS_CATALOG_DEFAULT.find(f => f.code === fabricCode);

  const fabrics = useMemo(() => {
    if (!sku) return FABRICS_CATALOG_DEFAULT;
    return FABRICS_CATALOG_DEFAULT.filter(f =>
      !f.forCategories || f.forCategories.includes(sku.category)
    );
  }, [sku]);

  const calc = useMemo(() => {
    if (!sku) return null;

    const baseSewing = sku.sewingPrice || PRICES.type[sku.category] || 0;
    const fabricPrice = fabric ? (fabric.priceUSD || 0) * usdRate * (sku.mainFabricUsage || 0) : 0;
    const fitSurcharge = PRICES.fit?.[sku.fit || 'regular'] || 0;
    const baseUnit = baseSewing + fabricPrice + fitSurcharge;

    let printPrice = 0;
    if (tech === 'screen') {
      const tier = getTier(PRICES.screenTiers, qty);
      const matrix = PRICES.screenMatrix?.[format];
      printPrice = matrix?.[String(colors)]?.[tier] || PRICES.tech?.screen || 0;
    } else if (tech === 'flex') {
      const tier = getTier(PRICES.flexTiers || [1, 20, 35, 50], qty);
      const matrix = PRICES.flexMatrix?.[format];
      printPrice = matrix?.[String(colors)]?.[tier] || PRICES.tech?.flex || 0;
    } else {
      printPrice = PRICES.tech?.[tech] || 0;
    }

    const unitPrice = Math.round(baseUnit + printPrice);
    const total = unitPrice * qty;

    return { baseSewing, fabricPrice: Math.round(fabricPrice), fitSurcharge, printPrice, unitPrice, total };
  }, [sku, fabric, qty, tech, format, colors, usdRate]);

  const categories = useMemo(() => {
    const cats = {};
    for (const s of SKU_CATALOG_DEFAULT) {
      if (!cats[s.category]) cats[s.category] = [];
      cats[s.category].push(s);
    }
    return cats;
  }, []);

  return (
    <div className="exp-overlay" onClick={onClose}>
      <div className="exp-panel" onClick={e => e.stopPropagation()}>
        <div className="exp-header">
          <span className="exp-title">Express калькулятор</span>
          <button className="exp-close" onClick={onClose}>✕</button>
        </div>
        <div className="exp-body">
          <div className="exp-field">
            <label>Изделие</label>
            <select value={skuCode} onChange={e => { setSkuCode(e.target.value); setFabricCode(''); }}>
              <option value="">— Выберите —</option>
              {Object.entries(categories).map(([cat, items]) => (
                <optgroup key={cat} label={TYPE_NAMES[cat] || cat}>
                  {items.map(s => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="exp-field">
            <label>Ткань</label>
            <select value={fabricCode} onChange={e => setFabricCode(e.target.value)}>
              <option value="">— Выберите —</option>
              {fabrics.map(f => (
                <option key={f.code} value={f.code}>
                  {f.name} — ${f.priceUSD}/м ({Math.round(f.priceUSD * usdRate)} ₽/м)
                </option>
              ))}
            </select>
          </div>

          <div className="exp-field">
            <label>Тираж (шт)</label>
            <input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} min="1" />
          </div>

          <div className="exp-field">
            <label>Техника нанесения</label>
            <select value={tech} onChange={e => setTech(e.target.value)}>
              {Object.entries(TECH_NAMES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {(tech === 'screen' || tech === 'flex') && (
            <>
              <div className="exp-field">
                <label>Формат</label>
                <select value={format} onChange={e => setFormat(e.target.value)}>
                  {(tech === 'screen' ? ['A4', 'A3', 'A3+', 'Max'] : ['A6', 'A5', 'A4', 'A3']).map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div className="exp-field">
                <label>Кол-во цветов</label>
                <input type="number" value={colors} onChange={e => setColors(Math.max(1, Math.min(tech === 'screen' ? 8 : 3, parseInt(e.target.value) || 1)))} min="1" max={tech === 'screen' ? 8 : 3} />
              </div>
            </>
          )}

          {calc && (
            <div className="exp-result">
              <div className="exp-result-row"><span>Пошив</span><b>{calc.baseSewing} ₽</b></div>
              <div className="exp-result-row"><span>Ткань</span><b>{calc.fabricPrice} ₽</b></div>
              {calc.fitSurcharge > 0 && <div className="exp-result-row"><span>Крой</span><b>+{calc.fitSurcharge} ₽</b></div>}
              <div className="exp-result-row"><span>Нанесение</span><b>{calc.printPrice} ₽</b></div>
              <div className="exp-result-total">
                <span>Цена/шт</span>
                <b>{calc.unitPrice} ₽</b>
              </div>
              <div className="exp-result-total" style={{ paddingTop: 6, marginTop: 4, fontSize: 14 }}>
                <span>ИТОГО ({qty} шт)</span>
                <b style={{ fontSize: 18 }}>{calc.total.toLocaleString('ru-RU')} ₽</b>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
