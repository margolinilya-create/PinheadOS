import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { ZONE_LABELS, TECH_NAMES } from '../../data';
import { hasNoPrint, getZoneSurcharge } from '../../utils/pricing';
import ZoneTechBlock from './ZoneTechBlock';
import LabelConfigurator from './LabelConfigurator';
import ZoneMockup from './ZoneMockup';

const ALL_ZONES = ['front', 'back', 'sleeve-l', 'sleeve-r', 'hood'];

const SHORT_TECH = { screen: 'Шелко', flex: 'Flex', dtg: 'DTG', embroidery: 'Выш.', dtf: 'DTF' };

function getZoneMiniSummary(zone, state) {
  const tech = state.zoneTechs?.[zone] || 'screen';
  const surcharge = getZoneSurcharge(zone, state);
  const label = SHORT_TECH[tech] || TECH_NAMES[tech] || tech;
  let fmt = '';
  let colors = '';
  if (tech === 'screen') {
    const p = state.zonePrints?.[zone] || { colors: 1, size: 'A4' };
    fmt = p.size || 'A4';
    colors = `${p.colors || 1}цв.`;
  } else if (tech === 'flex') {
    const p = state.flexZones?.[zone] || { colors: 1, size: 'A4' };
    fmt = p.size || 'A4';
    colors = `${p.colors || 1}цв.`;
  } else if (tech === 'dtg') {
    const p = state.dtgZones?.[zone] || { size: 'A4' };
    fmt = p.size || 'A4';
  } else if (tech === 'embroidery') {
    const p = state.embZones?.[zone] || { colors: 3, area: 's' };
    fmt = (p.area || 's').toUpperCase();
    colors = `${p.colors || 3}цв.`;
  } else if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || { size: 'A4' };
    fmt = p.size || 'A4';
  }
  const parts = [label, fmt, colors, `+${surcharge} ₽`].filter(Boolean);
  return parts.join(' · ');
}

export default function StepDesign() {
  const { sku, type, color, zones, toggleZone, noPrint, toggleNoPrint, designNotes, setField, nextStep, prevStep,
    sizes, customSizes, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones } = useStore(
    useShallow(s => ({ sku: s.sku, type: s.type, color: s.color, zones: s.zones, toggleZone: s.toggleZone,
      noPrint: s.noPrint, toggleNoPrint: s.toggleNoPrint, designNotes: s.designNotes, setField: s.setField,
      nextStep: s.nextStep, prevStep: s.prevStep, sizes: s.sizes, customSizes: s.customSizes,
      zoneTechs: s.zoneTechs, zonePrints: s.zonePrints, flexZones: s.flexZones, dtgZones: s.dtgZones,
      embZones: s.embZones, dtfZones: s.dtfZones }))
  );
  const store = { zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones, sizes, customSizes };
  const [screenConfirmed, setScreenConfirmed] = useState(false);

  if (!sku) {
    return <div className="step-panel"><div className="empty-state">Сначала выберите изделие</div></div>;
  }

  const availableZones = sku.zones || [];
  const displayZones = ALL_ZONES.filter(z => availableZones.includes(z) || ALL_ZONES.includes(z));
  const noPrintType = hasNoPrint(type);

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 03 — Дизайн</div>
        <h1 className="step-header-title">ДИЗАЙН</h1>
        <p className="step-header-desc">Настройте зоны нанесения и параметры печати</p>
      </div>
      {noPrintType ? (
        <div className="empty-state">Для данного типа изделия нанесение не предусмотрено</div>
      ) : (
        <>
          <div className="section-label">Зоны нанесения</div>
          <div className="design-layout">
            <div className="design-zones-col">
              <div className="zones-grid">
                {/* "Без нанесения" — first, as a zone card */}
                <div
                  className={`zone-card zone-card-noprint${noPrint ? ' selected' : ''}`}
                  onClick={toggleNoPrint}
                >
                  <div className="zone-bar" />
                  <div className="zone-card-inner">
                    <div className="zone-label">Без нанесения</div>
                  </div>
                  <div className="zone-check">{noPrint ? '✓' : ''}</div>
                </div>

                {displayZones.map(z => {
                  const available = availableZones.includes(z);
                  const active = zones.includes(z);
                  const cls = `zone-card${active ? ' selected' : ''}${!available ? ' disabled' : ''}`;
                  return (
                    <div
                      key={z}
                      className={cls}
                      onClick={() => available && toggleZone(z)}
                      title={!available ? 'Недоступно для этого изделия' : undefined}
                    >
                      <div className="zone-bar" />
                      <div className="zone-card-inner">
                        <div className="zone-label">{ZONE_LABELS[z] || z}</div>
                        {active && <div className="zone-mini-summary">{getZoneMiniSummary(z, store)}</div>}
                      </div>
                      <div className="zone-check">{active ? '✓' : ''}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="design-mockup-col">
              <ZoneMockup
                garmentType={sku.mockupType || type}
                activeZones={zones}
                availableZones={availableZones}
                color={color}
                zoneTechs={zoneTechs}
                zonePrints={zonePrints}
                flexZones={flexZones}
                dtgZones={dtgZones}
                embZones={embZones}
                dtfZones={dtfZones}
              />
            </div>
          </div>

          {zones.length > 0 && !noPrint && (
            <>
              <div className="section-label" style={{ marginTop: 24 }}>Техника нанесения по зонам</div>
              <div className="zone-tech-blocks">
                {zones.map(z => (
                  <div key={z}>
                    <ZoneTechBlock zone={z} />
                    <div className="zone-tech-summary">{getZoneMiniSummary(z, store)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Бирки и этикетки ── */}
      <div className="section-label" style={{ marginTop: 32 }}>Бирки и этикетки</div>
      <LabelConfigurator />

      {/* ── Заметки по дизайну ── */}
      <div className="section-label" style={{ marginTop: 24 }}>Заметки по дизайну</div>
      <div className="label-field full">
        <textarea
          placeholder="Описание дизайна, ссылки на макеты, пожелания..."
          value={designNotes}
          onChange={e => setField('designNotes', e.target.value)}
          rows={3}
        />
      </div>

      {(() => {
        const totalQty = Object.values(sizes || {}).reduce((sum, q) => sum + (parseInt(q) || 0), 0)
          + (customSizes || []).reduce((sum, c) => sum + (parseInt(c.qty) || 0), 0);
        const hasScreen = zones.some(z => (zoneTechs?.[z] || 'screen') === 'screen');
        const screenWarn = hasScreen && totalQty > 0 && totalQty < 50;
        const canProceed = (noPrint || noPrintType || zones.length > 0) && (!screenWarn || screenConfirmed);
        return (
          <>
            {screenWarn && (
              <div className="warning-banner" style={{ background: '#fff8e1', border: '1.5px solid #f0c040', padding: '12px 16px', marginTop: 16, fontSize: 13 }}>
                <div style={{ marginBottom: 6 }}>⚠ Шелкография — минимальный тираж от 50 шт. Сейчас: {totalQty} шт.</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={screenConfirmed} onChange={e => setScreenConfirmed(e.target.checked)} />
                  Я понимаю и хочу продолжить
                </label>
              </div>
            )}
            <div className="btn-row">
              <button className="btn-prev" onClick={prevStep}>← Назад</button>
              <button className={`btn-next${!canProceed ? ' disabled' : ''}`}
                onClick={() => canProceed && nextStep()}>
                Далее
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}
