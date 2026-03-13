import { useStore } from '../../store/useStore';
import { ZONE_LABELS } from '../../data';
import { TECH_TABS, getZoneSurcharge, SCREEN_FX, FLEX_FORMATS, FLEX_MAX_COLORS, getTotalQty } from '../../utils/pricing';

const SCREEN_FORMATS = ['A4', 'A3', 'A3+', 'Max'];
const SCREEN_MAX_COLORS = 8;
const DTG_FORMATS = ['A6', 'A5', 'A4', 'A3', 'A3+'];
const DTF_FORMATS = ['A6', 'A5', 'A4', 'A3', 'A3+'];
const EMB_AREAS = [{ k: 's', l: 'S до 7см' }, { k: 'm', l: 'M до 12см' }, { k: 'l', l: 'L до 20см' }];

export default function ZoneTechBlock({ zone }) {
  const state = useStore();
  const { zoneTechs, setZoneTech } = state;
  const tech = zoneTechs?.[zone] || 'screen';
  const surcharge = getZoneSurcharge(zone, state);
  const totalQty = getTotalQty(state) || 1;

  return (
    <div className="zone-tech-block">
      <div className="zone-tech-header">
        <span>{ZONE_LABELS[zone] || zone}</span>
        <span className="zone-surcharge">+{surcharge} ₽/шт</span>
      </div>
      <div className="zone-tech-tabs">
        {TECH_TABS.map(t => (
          <button key={t.key} className={`zone-tech-tab${tech === t.key ? ' active' : ''}`} onClick={() => setZoneTech(zone, t.key)}>
            {t.label}
          </button>
        ))}
      </div>
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
  const { zonePrints, setZoneParam } = useStore();
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
  const { flexZones, setZoneParam } = useStore();
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
  const { dtgZones, setZoneParam } = useStore();
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

function EmbParams({ zone }) {
  const { embZones, setZoneParam } = useStore();
  const p = embZones?.[zone] || { colors: 3, area: 's' };
  return (
    <>
      <ParamRow label="Область">
        <div className="zone-param-btns">
          {EMB_AREAS.map(a => <button key={a.k} className={`zone-param-btn${p.area === a.k ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'embroidery', 'area', a.k)}>{a.l}</button>)}
        </div>
      </ParamRow>
      <ParamRow label="Цветов нити">
        <div className="zone-colors-wrap">
          <button className="zone-param-btn" onClick={() => setZoneParam(zone, 'embroidery', 'colors', Math.max(1, (p.colors || 3) - 1))}>−</button>
          <input className="zone-colors-input" type="number" min={1} max={20} value={p.colors || 3}
            onChange={e => setZoneParam(zone, 'embroidery', 'colors', parseInt(e.target.value) || 1)} />
          <button className="zone-param-btn" onClick={() => setZoneParam(zone, 'embroidery', 'colors', Math.min(20, (p.colors || 3) + 1))}>+</button>
        </div>
      </ParamRow>
    </>
  );
}

function DtfParams({ zone }) {
  const { dtfZones, setZoneParam } = useStore();
  const p = dtfZones?.[zone] || { size: 'A4' };
  return (
    <ParamRow label="Размер">
      <div className="zone-param-btns">
        {DTF_FORMATS.map(s => <button key={s} className={`zone-param-btn${p.size === s ? ' active' : ''}`} onClick={() => setZoneParam(zone, 'dtf', 'size', s)}>{s}</button>)}
      </div>
    </ParamRow>
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
