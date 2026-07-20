import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { ZONE_LABELS } from '../../../data';
import { TECH_TABS, getZoneSurcharge, SCREEN_FX, FLEX_FORMATS, FLEX_MAX_COLORS, getTotalQty } from '../../utils/pricing';
import { useEffectiveRules } from '../../hooks/useEffectiveRules';
import { isTechAllowed } from '../../utils/skuRules';

const SCREEN_FORMATS = ['A4', 'A3', 'A3+', 'Max'];
const SCREEN_MAX_COLORS = 8;
const DTG_FORMATS = ['A6', 'A5', 'A4', 'A3', 'A3+'];
const DTF_FORMATS = ['A6', 'A5', 'A4', 'A3', 'A3+'];
const TECH_HELP = {
  screen: 'Шелкография — оптимально для тиражей от 50 шт.',
  flex: 'Флекс-печать — для малых тиражей, до 3 цветов',
  dtg: 'DTG — прямая печать, любое кол-во цветов',
  embroidery: 'Вышивка — премиальный вид, от 350₽',
  dtf: 'DTF — плёночный трансфер, от 180₽',
};

export default function ZoneTechBlock({ zone }) {
  const { zoneTechs, setZoneTech } = useStore(
    useShallow(s => ({ zoneTechs: s.zoneTechs, setZoneTech: s.setZoneTech }))
  );
  const tech = zoneTechs?.[zone] || 'screen';
  const surcharge = useStore(s => getZoneSurcharge(zone, s));
  const totalQty = useStore(s => getTotalQty(s)) || 1;
  const rules = useEffectiveRules();

  return (
    <div className="zone-tech-block">
      <div className="zone-tech-header">
        <span>{ZONE_LABELS[zone] || zone}</span>
        <span className="zone-surcharge">+{surcharge} ₽/шт</span>
      </div>
      <div className="zone-tech-tabs">
        {TECH_TABS.map(t => {
          const allowed = !rules || isTechAllowed(rules, t.key, zone);
          return (
            <button
              key={t.key}
              className={`zone-tech-tab${tech === t.key ? ' active' : ''}${!allowed ? ' disabled' : ''}`}
              onClick={() => allowed && setZoneTech(zone, t.key)}
              disabled={!allowed}
              title={!allowed ? `${t.label} недоступна для этой зоны/категории` : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {TECH_HELP[tech] && (
        <div className="zone-tech-help" style={{ fontSize: 12, color: '#888', margin: '4px 0 8px', fontStyle: 'italic' }}>
          {TECH_HELP[tech]}
        </div>
      )}
      <div className="zone-tech-params">
        {tech === 'screen' && <ScreenParams zone={zone} qty={totalQty} />}
        {tech === 'flex' && <FlexParams zone={zone} qty={totalQty} />}
        {tech === 'dtg' && <DtgParams zone={zone} />}
        {tech === 'embroidery' && <EmbParams zone={zone} />}
        {tech === 'dtf' && <DtfParams zone={zone} />}
      </div>
    </div>
  );
}

function ScreenParams({ zone, qty }) {
  const { zonePrints, setZoneParam } = useStore(
    useShallow(s => ({ zonePrints: s.zonePrints, setZoneParam: s.setZoneParam }))
  );
  const p = zonePrints?.[zone] || { colors: 1, size: 'A4', textile: 'white', fx: 'none' };

  return (
    <>
      <ParamRow label="Формат">
        <div className="zone-param-btns">
          {SCREEN_FORMATS.map(s => <button key={s} className={`zone-param-btn${p.size === s ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'screen', 'size', s)}>{s}</button>)}
        </div>
      </ParamRow>
      <ParamRow label="Цвета">
        <div className="zone-colors-wrap">
          <button className="zone-param-btn" onClick={() => setZoneParam(zone, 'screen', 'colors', Math.max(1, (p.colors || 1) - 1))}>−</button>
          <input className="zone-colors-input" type="number" min={1} max={SCREEN_MAX_COLORS} value={p.colors || 1}
            onChange={e => setZoneParam(zone, 'screen', 'colors', Math.min(SCREEN_MAX_COLORS, Math.max(1, parseInt(e.target.value) || 1)))} />
          <button className="zone-param-btn" onClick={() => setZoneParam(zone, 'screen', 'colors', Math.min(SCREEN_MAX_COLORS, (p.colors || 1) + 1))}>+</button>
        </div>
      </ParamRow>
      <ParamRow label="Текстиль">
        <div className="zone-param-btns">
          <button className={`zone-param-btn${(p.textile || 'white') === 'white' ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'screen', 'textile', 'white')}>Белый</button>
          <button className={`zone-param-btn${p.textile === 'color' ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'screen', 'textile', 'color')}>Цветной ×1.3</button>
        </div>
      </ParamRow>
      <ParamRow label="Спецэффект">
        <div className="zone-fx-btns">
          {SCREEN_FX.map(f => (
            <button key={f.key} className={`zone-fx-btn${(p.fx || 'none') === f.key ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'screen', 'fx', f.key)}>
              {f.label}{f.mult > 1 && <span className="fx-mult">×{f.mult}</span>}
            </button>
          ))}
        </div>
      </ParamRow>
      {qty > 0 && qty < 50 && (
        <div className="zone-tech-warn">⚠ Шелкография — минимальный тираж от 50 шт. Сейчас: {qty} шт</div>
      )}
    </>
  );
}

function FlexParams({ zone }) {
  const { flexZones, setZoneParam } = useStore(
    useShallow(s => ({ flexZones: s.flexZones, setZoneParam: s.setZoneParam }))
  );
  const p = flexZones?.[zone] || { colors: 1, size: 'A4' };
  return (
    <>
      <ParamRow label="Формат">
        <div className="zone-param-btns">
          {FLEX_FORMATS.map(s => <button key={s} className={`zone-param-btn${p.size === s ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'flex', 'size', s)}>{s}</button>)}
        </div>
      </ParamRow>
      <ParamRow label="Цвета">
        <div className="zone-colors-wrap">
          <button className="zone-param-btn" onClick={() => setZoneParam(zone, 'flex', 'colors', Math.max(1, (p.colors || 1) - 1))}>−</button>
          <input className="zone-colors-input" type="number" min={1} max={FLEX_MAX_COLORS} value={p.colors || 1}
            onChange={e => setZoneParam(zone, 'flex', 'colors', Math.min(FLEX_MAX_COLORS, Math.max(1, parseInt(e.target.value) || 1)))} />
          <button className="zone-param-btn" onClick={() => setZoneParam(zone, 'flex', 'colors', Math.min(FLEX_MAX_COLORS, (p.colors || 1) + 1))}>+</button>
        </div>
      </ParamRow>
    </>
  );
}

function DtgParams({ zone }) {
  const { dtgZones, setZoneParam } = useStore(
    useShallow(s => ({ dtgZones: s.dtgZones, setZoneParam: s.setZoneParam }))
  );
  const p = dtgZones?.[zone] || { size: 'A4', textile: 'white' };
  return (
    <>
      <ParamRow label="Размер">
        <div className="zone-param-btns">
          {DTG_FORMATS.map(s => <button key={s} className={`zone-param-btn${p.size === s ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'dtg', 'size', s)}>{s}</button>)}
        </div>
      </ParamRow>
      <ParamRow label="Текстиль">
        <div className="zone-param-btns">
          <button className={`zone-param-btn${(p.textile || 'white') === 'white' ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'dtg', 'textile', 'white')}>Белый</button>
          <button className={`zone-param-btn${p.textile === 'color' ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'dtg', 'textile', 'color')}>Цветной</button>
        </div>
      </ParamRow>
    </>
  );
}

const EMB_FILL_OPTIONS = [
  { value: 1.0, label: '100%' },
  { value: 0.8, label: '80%' },
  { value: 0.6, label: '60%' },
];
const EMB_EXTRA_OPTIONS = [
  { value: null, label: 'Нет' },
  { value: 'metallic', label: 'Металлик (+20%)' },
  { value: 'puff', label: 'Объёмная-puff (+50%)' },
];

function EmbParams({ zone }) {
  const { embZones, setZoneParam } = useStore(
    useShallow(s => ({ embZones: s.embZones, setZoneParam: s.setZoneParam }))
  );
  const p = embZones?.[zone] || { width_mm: 50, height_mm: 50, fill: 1.0, extra: null };
  const stitches = Math.round((p.width_mm || 50) / 10 * (p.height_mm || 50) / 10 * 300 * (p.fill || 1));
  return (
    <>
      <ParamRow label="Ширина">
        <div className="zone-colors-wrap">
          <input className="zone-colors-input" type="number" min={5} max={400} value={p.width_mm || 50} style={{ width: 60 }}
            onChange={e => setZoneParam(zone, 'embroidery', 'width_mm', parseInt(e.target.value) || 50)} />
          <span style={{ fontSize: 11, color: '#888' }}>мм</span>
        </div>
      </ParamRow>
      <ParamRow label="Высота">
        <div className="zone-colors-wrap">
          <input className="zone-colors-input" type="number" min={5} max={400} value={p.height_mm || 50} style={{ width: 60 }}
            onChange={e => setZoneParam(zone, 'embroidery', 'height_mm', parseInt(e.target.value) || 50)} />
          <span style={{ fontSize: 11, color: '#888' }}>мм</span>
        </div>
      </ParamRow>
      <ParamRow label="Заполняемость">
        <select className="zone-select" value={p.fill || 1.0} onChange={e => setZoneParam(zone, 'embroidery', 'fill', parseFloat(e.target.value))}>
          {EMB_FILL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </ParamRow>
      <ParamRow label="Доп эффект">
        <select className="zone-select" value={p.extra || ''} onChange={e => setZoneParam(zone, 'embroidery', 'extra', e.target.value || null)}>
          {EMB_EXTRA_OPTIONS.map(o => <option key={o.value || 'none'} value={o.value || ''}>{o.label}</option>)}
        </select>
      </ParamRow>
      <div style={{ fontSize: 11, color: '#888', margin: '4px 0' }}>
        ≈ {stitches.toLocaleString()} стежков
      </div>
    </>
  );
}

const DTF_FMT_SIZES = {
  'A6': { w: 105, h: 148 },
  'A5': { w: 148, h: 210 },
  'A4': { w: 210, h: 297 },
  'A3': { w: 297, h: 420 },
  'A3+': { w: 329, h: 483 },
};

function DtfParams({ zone }) {
  const { dtfZones, setZoneParam } = useStore(
    useShallow(s => ({ dtfZones: s.dtfZones, setZoneParam: s.setZoneParam }))
  );
  const p = dtfZones?.[zone] || { fmt: 'A4', width_mm: 210, height_mm: 297 };
  const selectFmt = (fmt) => {
    const sz = DTF_FMT_SIZES[fmt];
    if (sz) {
      setZoneParam(zone, 'dtf', 'fmt', fmt);
      setZoneParam(zone, 'dtf', 'width_mm', sz.w);
      setZoneParam(zone, 'dtf', 'height_mm', sz.h);
    }
  };
  return (
    <>
      <ParamRow label="Формат">
        <div className="zone-param-btns">
          {DTF_FORMATS.map(s => <button key={s} className={`zone-param-btn${(p.fmt || p.size) === s ? ' active' : ''}`} onClick={() => selectFmt(s)}>{s}</button>)}
        </div>
      </ParamRow>
      <ParamRow label="Ширина">
        <div className="zone-colors-wrap">
          <input className="zone-colors-input" type="number" min={10} max={550} value={p.width_mm || 210} style={{ width: 60 }}
            onChange={e => setZoneParam(zone, 'dtf', 'width_mm', parseInt(e.target.value) || 210)} />
          <span style={{ fontSize: 11, color: '#888' }}>мм</span>
        </div>
      </ParamRow>
      <ParamRow label="Высота">
        <div className="zone-colors-wrap">
          <input className="zone-colors-input" type="number" min={10} max={1000} value={p.height_mm || 297} style={{ width: 60 }}
            onChange={e => setZoneParam(zone, 'dtf', 'height_mm', parseInt(e.target.value) || 297)} />
          <span style={{ fontSize: 11, color: '#888' }}>мм</span>
        </div>
      </ParamRow>
    </>
  );
}

function ParamRow({ label, children }) {
  return (
    <div className="zone-param-row">
      <div className="zone-param-label">{label}</div>
      {children}
    </div>
  );
}
