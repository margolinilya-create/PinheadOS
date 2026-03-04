import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { ZONE_LABELS } from '../../data';
import { SKU_CATALOG_DEFAULT, SKU_CATEGORIES } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { PRICES } from '../../data/prices';
import { screenLookup, flexLookup, SCREEN_FX, FLEX_FORMATS, FLEX_MAX_COLORS, TECH_TABS } from '../../utils/pricing';

// ── Constants ──
const SCREEN_FORMATS = ['A4', 'A3', 'A3+', 'Max'];
const SCREEN_MAX_COLORS = 8;
const SCREEN_TEXTILE_MULT = 1.3;
const DTG_DTF_FORMATS = ['A6', 'A5', 'A4', 'A3', 'A3+'];
const EMB_AREAS = [
  { k: 's', l: 'до 7см' },
  { k: 'm', l: 'до 12см' },
  { k: 'l', l: 'до 20см' },
];
const TEXTILES = [
  { k: 'white', l: 'Белый' },
  { k: 'color', l: 'Цвет ×1.3' },
];

const TECH_OPTIONS = [
  { key: 'screen', label: 'Шелкография' },
  { key: 'flex', label: 'Flex' },
  { key: 'dtf', label: 'DTF' },
  { key: 'dtg', label: 'DTG' },
  { key: 'embroidery', label: 'Вышивка' },
];

const DEFAULT_GARMENT_ZONES = ['front', 'back', 'sleeve-l', 'sleeve-r'];

function makeDefaultZoneEntry(active) {
  return { active, tech: 'screen', fmt: 'A4', col: 1, textile: 'white', fx: 'none' };
}

function initZoneData(zones) {
  const data = {};
  zones.forEach((zId, i) => {
    data[zId] = makeDefaultZoneEntry(i === 0);
  });
  return data;
}

function calcZoneSurcharge(zoneId, d, qty) {
  if (!d || !d.active) return 0;
  const { tech, fmt, col, textile, fx } = d;

  if (tech === 'screen') {
    let base = screenLookup(fmt, col, qty);
    if (textile === 'color') base = Math.round(base * SCREEN_TEXTILE_MULT);
    const fxEntry = SCREEN_FX.find(f => f.key === (fx || 'none'));
    if (fxEntry && fxEntry.mult > 1) base = Math.round(base * fxEntry.mult);
    return base;
  }
  if (tech === 'flex') {
    return flexLookup(fmt, col, qty);
  }
  if (tech === 'dtf') {
    return (PRICES.tech.dtf || 180) + (PRICES.dtfFormatAdd?.[fmt] || 0);
  }
  if (tech === 'dtg') {
    return (PRICES.tech.dtg || 280) + (PRICES.dtgFormatAdd?.[fmt] || 0);
  }
  if (tech === 'embroidery') {
    return (PRICES.tech.embroidery || 350) + (PRICES.embAreaAdd?.[fmt] || 0) + Math.max(0, col - 1) * (PRICES.embColorAdd || 20);
  }
  return 0;
}

// ── Component ──
export default function ExpressCalc() {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const usdRate = useStore(s => s.usdRate);

  const [skuCode, setSkuCode] = useState('');
  const [fabricCode, setFabricCode] = useState('');
  const [qty, setQty] = useState(100);
  const [expZoneData, setExpZoneData] = useState({});

  // ── SKU catalog grouped by category ──
  const categories = useMemo(() => {
    const cats = {};
    for (const s of SKU_CATALOG_DEFAULT) {
      if (!cats[s.category]) cats[s.category] = [];
      cats[s.category].push(s);
    }
    return cats;
  }, []);

  const catLabels = useMemo(() => {
    const map = {};
    for (const c of SKU_CATEGORIES) map[c.id] = c.name;
    return map;
  }, []);

  // ── Selected SKU ──
  const sku = useMemo(() => SKU_CATALOG_DEFAULT.find(s => s.code === skuCode) || null, [skuCode]);

  // ── Fabrics filtered by SKU category ──
  const fabrics = useMemo(() => {
    if (!sku) return FABRICS_CATALOG_DEFAULT;
    return FABRICS_CATALOG_DEFAULT.filter(f =>
      !f.forCategories || f.forCategories.length === 0 || f.forCategories.includes(sku.category)
    );
  }, [sku]);

  const fabric = useMemo(() => FABRICS_CATALOG_DEFAULT.find(f => f.code === fabricCode) || null, [fabricCode]);

  // ── SKU zones ──
  const skuZones = useMemo(() => {
    if (!sku) return [];
    return sku.zones && sku.zones.length > 0 ? sku.zones : DEFAULT_GARMENT_ZONES;
  }, [sku]);

  // ── When SKU changes ──
  const handleSkuChange = useCallback((code) => {
    setSkuCode(code);
    setFabricCode('');
    const s = SKU_CATALOG_DEFAULT.find(x => x.code === code);
    if (s) {
      const zones = s.zones && s.zones.length > 0 ? s.zones : DEFAULT_GARMENT_ZONES;
      setExpZoneData(initZoneData(zones));
    } else {
      setExpZoneData({});
    }
  }, []);

  // ── Zone actions ──
  const activateZone = useCallback((zoneId) => {
    setExpZoneData(prev => ({
      ...prev,
      [zoneId]: { ...(prev[zoneId] || makeDefaultZoneEntry(false)), active: true },
    }));
  }, []);

  const deactivateZone = useCallback((zoneId) => {
    setExpZoneData(prev => {
      const activeCount = Object.values(prev).filter(d => d.active).length;
      if (activeCount <= 1) return prev;
      return { ...prev, [zoneId]: { ...prev[zoneId], active: false } };
    });
  }, []);

  const setZoneTech = useCallback((zoneId, tech) => {
    setExpZoneData(prev => {
      const d = { ...(prev[zoneId] || makeDefaultZoneEntry(true)) };
      d.tech = tech;
      if (tech === 'embroidery') { d.fmt = 's'; d.col = 1; }
      else if (tech === 'screen') { d.fmt = 'A4'; d.col = 1; d.textile = 'white'; d.fx = 'none'; }
      else if (tech === 'flex') { d.fmt = 'A4'; d.col = 1; }
      else { d.fmt = 'A4'; d.col = 1; }
      return { ...prev, [zoneId]: d };
    });
  }, []);

  const setZoneParam = useCallback((zoneId, key, val) => {
    setExpZoneData(prev => ({
      ...prev,
      [zoneId]: { ...prev[zoneId], [key]: val },
    }));
  }, []);

  // ── Calc results ──
  const calc = useMemo(() => {
    if (!sku) return null;

    // Base price from SKU + fabric
    const sewingPrice = sku.sewingPrice || 0;
    const fabricPriceRub = fabric ? Math.round(fabric.priceUSD * usdRate * (sku.mainFabricUsage || 0)) : 0;
    const base = sewingPrice + fabricPriceRub;

    // Tech surcharge from all active zones
    const activeEntries = Object.entries(expZoneData).filter(([, d]) => d.active);
    const zoneCount = activeEntries.length;
    let techTotal = 0;
    activeEntries.forEach(([id, d]) => {
      techTotal += calcZoneSurcharge(id, d, qty);
    });

    const unitPrice = base + techTotal;
    const total = unitPrice * qty;

    return { base, techTotal, zoneCount, unitPrice, total };
  }, [sku, fabric, usdRate, expZoneData, qty]);

  // ── Render zone params ──
  function renderZoneParams(zoneId, d) {
    const { tech } = d;

    if (tech === 'screen') {
      return (
        <>
          <span className="exp-plabel">Формат</span>
          <div className="exp-pbtns">
            {SCREEN_FORMATS.map(s => (
              <button key={s} className={`exp-pbtn${d.fmt === s ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'fmt', s)}>{s}</button>
            ))}
          </div>
          <span className="exp-plabel" style={{ marginLeft: 6 }}>Цвета</span>
          <div className="exp-pbtns">
            {Array.from({ length: SCREEN_MAX_COLORS }, (_, i) => i + 1).map(c => (
              <button key={c} className={`exp-pbtn${d.col === c ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'col', c)}>{c}</button>
            ))}
          </div>
          <span className="exp-plabel" style={{ marginLeft: 6 }}>Текстиль</span>
          <div className="exp-pbtns">
            {TEXTILES.map(t => (
              <button key={t.k} className={`exp-pbtn${(d.textile || 'white') === t.k ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'textile', t.k)}>{t.l}</button>
            ))}
          </div>
          <span className="exp-plabel" style={{ marginLeft: 6 }}>Эффект</span>
          <div className="exp-pbtns">
            {SCREEN_FX.map(f => (
              <button key={f.key} className={`exp-pbtn${(d.fx || 'none') === f.key ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'fx', f.key)}>{f.label}</button>
            ))}
          </div>
        </>
      );
    }

    if (tech === 'flex') {
      return (
        <>
          <span className="exp-plabel">Формат</span>
          <div className="exp-pbtns">
            {FLEX_FORMATS.map(s => (
              <button key={s} className={`exp-pbtn${d.fmt === s ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'fmt', s)}>{s}</button>
            ))}
          </div>
          <span className="exp-plabel" style={{ marginLeft: 6 }}>Цвета</span>
          <div className="exp-pbtns">
            {Array.from({ length: FLEX_MAX_COLORS }, (_, i) => i + 1).map(c => (
              <button key={c} className={`exp-pbtn${d.col === c ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'col', c)}>{c}</button>
            ))}
          </div>
        </>
      );
    }

    if (tech === 'dtf' || tech === 'dtg') {
      return (
        <>
          <span className="exp-plabel">Формат</span>
          <div className="exp-pbtns">
            {DTG_DTF_FORMATS.map(s => (
              <button key={s} className={`exp-pbtn${d.fmt === s ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'fmt', s)}>{s}</button>
            ))}
          </div>
        </>
      );
    }

    if (tech === 'embroidery') {
      return (
        <>
          <span className="exp-plabel">Область</span>
          <div className="exp-pbtns">
            {EMB_AREAS.map(a => (
              <button key={a.k} className={`exp-pbtn${d.fmt === a.k ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'fmt', a.k)}>{a.l}</button>
            ))}
          </div>
          <span className="exp-plabel" style={{ marginLeft: 6 }}>Нити</span>
          <div className="exp-pbtns">
            {[1, 2, 3, 4, 5].map(c => (
              <button key={c} className={`exp-pbtn${d.col === c ? ' active' : ''}`}
                onClick={() => setZoneParam(zoneId, 'col', c)}>{c}</button>
            ))}
          </div>
        </>
      );
    }

    return null;
  }

  // ── Render ──
  return (
    <div className="exp-overlay" onClick={onClose}>
      <div className="exp-panel" onClick={e => e.stopPropagation()}>
        <div className="exp-header">
          <span className="exp-title">Express калькулятор</span>
          <button className="exp-close" onClick={onClose}>✕</button>
        </div>
        <div className="exp-body">
          {/* SKU select */}
          <div className="exp-field">
            <label>Изделие</label>
            <select value={skuCode} onChange={e => handleSkuChange(e.target.value)}>
              <option value="">— Выберите —</option>
              {Object.entries(categories).map(([cat, items]) => (
                <optgroup key={cat} label={catLabels[cat] || cat}>
                  {items.map(s => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Fabric select */}
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

          {/* Quantity */}
          <div className="exp-field">
            <label>Тираж (шт)</label>
            <input
              type="number"
              value={qty}
              onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              min="1"
            />
          </div>

          {/* Per-zone technology blocks */}
          {sku && skuZones.length > 0 && (
            <div className="exp-field">
              <label>Зоны нанесения</label>
              <div className="exp-zones-wrap">
                {skuZones.map(zId => {
                  const d = expZoneData[zId];
                  if (!d) return null;

                  // Inactive zone — compact chip
                  if (!d.active) {
                    return (
                      <div key={zId} className="exp-zone-chip" onClick={() => activateZone(zId)}>
                        <span className="exp-zone-dot" />
                        {ZONE_LABELS[zId] || zId}
                      </div>
                    );
                  }

                  // Active zone — expanded block
                  const surcharge = calcZoneSurcharge(zId, d, qty);
                  const screenWarn = d.tech === 'screen' && qty > 0 && qty < 50;

                  return (
                    <div key={zId} className="exp-zt-block active">
                      <div className="exp-zt-header" onClick={() => deactivateZone(zId)}>
                        <span className="exp-zt-name">{ZONE_LABELS[zId] || zId}</span>
                        <span className="exp-zt-surcharge">+{surcharge} ₽</span>
                      </div>
                      <div className="exp-zt-body">
                        <div className="exp-zt-techs">
                          {TECH_OPTIONS.map(t => (
                            <div
                              key={t.key}
                              className={`exp-zt-tech${d.tech === t.key ? ' active' : ''}`}
                              onClick={() => setZoneTech(zId, t.key)}
                            >
                              {t.label}
                            </div>
                          ))}
                        </div>
                        <div className="exp-zt-params">
                          {renderZoneParams(zId, d)}
                        </div>
                        {screenWarn && (
                          <div className="exp-zt-warn">⚠ Шелкография — минимальный тираж от 50 шт</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No-print message for socks etc */}
          {sku && skuZones.length === 0 && (
            <div className="exp-zt-warn" style={{ padding: '12px 0' }}>
              Для данного изделия нанесение недоступно
            </div>
          )}

          {/* Results */}
          {calc && (
            <div className="exp-result">
              <div className="exp-result-row">
                <span>База (пошив + ткань)</span>
                <b>{calc.base.toLocaleString('ru-RU')} ₽ / шт</b>
              </div>
              <div className="exp-result-row">
                <span>
                  {calc.zoneCount > 0
                    ? `Нанесение × ${calc.zoneCount} зон${calc.zoneCount === 1 ? 'а' : 'ы'}`
                    : 'Нанесение'}
                </span>
                <b>{skuZones.length === 0 ? '—' : `${calc.techTotal.toLocaleString('ru-RU')} ₽ / шт`}</b>
              </div>
              <div className="exp-result-total">
                <span>Цена / шт</span>
                <b>{calc.unitPrice.toLocaleString('ru-RU')} ₽</b>
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
