import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { ZONE_LABELS, TECH_NAMES } from '../../../data';
import { hasNoPrint, getZoneSurcharge } from '../../utils/pricing';
import { getZoneName } from '../../utils/skuRules';
import { toast } from '../../../store/useToastStore';
import ZoneTechBlock from './ZoneTechBlock';
import LabelConfigurator from './LabelConfigurator';
import ZoneMockup from './ZoneMockup';
import styles from './StepDesign.module.css';

// ALL_ZONES removed — now uses sku.zones from store directly

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
    const p = state.embZones?.[zone] || { width_mm: 50, height_mm: 50 };
    fmt = `${p.width_mm || 50}×${p.height_mm || 50}мм`;
    colors = p.extra ? (p.extra === 'metallic' ? 'металлик' : 'puff') : null;
  } else if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || { fmt: 'A4' };
    fmt = p.fmt || p.size || 'A4';
  }
  const parts = [label, fmt, colors, `+${surcharge} ₽`].filter(Boolean);
  return parts.join(' · ');
}

export default function StepDesign() {
  const { sku, type, color, zones, toggleZone, noPrint, toggleNoPrint, designNotes, setField, nextStep, prevStep,
    sizes, customSizes, zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones,
    artworkPath, setArtworkPath, zonesCatalog } = useStore(
    useShallow(s => ({ sku: s.sku, type: s.type, color: s.color, zones: s.zones, toggleZone: s.toggleZone,
      noPrint: s.noPrint, toggleNoPrint: s.toggleNoPrint, designNotes: s.designNotes, setField: s.setField,
      nextStep: s.nextStep, prevStep: s.prevStep, sizes: s.sizes, customSizes: s.customSizes,
      zoneTechs: s.zoneTechs, zonePrints: s.zonePrints, flexZones: s.flexZones, dtgZones: s.dtgZones,
      embZones: s.embZones, dtfZones: s.dtfZones,
      artworkPath: s.artworkPath, setArtworkPath: s.setArtworkPath,
      zonesCatalog: s.zonesCatalog }))
  );
  const store = { zoneTechs, zonePrints, flexZones, dtgZones, embZones, dtfZones, sizes, customSizes };
  const [screenConfirmed, setScreenConfirmed] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  if (!sku) {
    return <div className="step-panel"><div className="empty-state">Сначала выберите изделие</div></div>;
  }

  const displayZones = sku.zones || [];
  const noPrintType = hasNoPrint(type);

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 02 — Дизайн</div>
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
                <button
                  type="button"
                  className={`zone-card zone-card-noprint${noPrint ? ' selected' : ''}`}
                  onClick={toggleNoPrint}
                  aria-pressed={noPrint}
                >
                  <div className="zone-bar" />
                  <div className="zone-card-inner">
                    <div className="zone-label">Без нанесения</div>
                  </div>
                  <div className="zone-check">{noPrint ? '✓' : ''}</div>
                </button>

                {displayZones.map(z => {
                  const available = displayZones.includes(z);
                  const active = zones.includes(z);
                  const cls = `zone-card${active ? ' selected' : ''}`;
                  return (
                    <button
                      type="button"
                      key={z}
                      className={cls}
                      onClick={() => toggleZone(z)}
                      disabled={!available}
                      aria-pressed={active}
                      aria-label={getZoneName(z, zonesCatalog)}
                    >
                      <div className="zone-bar" />
                      <div className="zone-card-inner">
                        <div className="zone-label">{getZoneName(z, zonesCatalog)}</div>
                        {active && <div className="zone-mini-summary">{getZoneMiniSummary(z, store)}</div>}
                      </div>
                      <div className="zone-check">{active ? '✓' : ''}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="design-mockup-col">
              {sku?.mockupType && <ZoneMockup
                garmentType={sku.mockupType}
                activeZones={zones}
                displayZones={displayZones}
                color={color}
                zoneTechs={zoneTechs}
                zonePrints={zonePrints}
                flexZones={flexZones}
                dtgZones={dtgZones}
                embZones={embZones}
                dtfZones={dtfZones}
              />}
            </div>
          </div>

          {zones.length > 0 && !noPrint && (
            <>
              <div className={`section-label ${styles.sectionSpaced}`}>Техника нанесения по зонам</div>
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
      <div className={`extras-accordion ${styles.sectionSpacedLg}`}>
        <button
          className={`extras-accordion-toggle ${styles.accordionToggle}`}
          onClick={() => setShowLabels(v => !v)}
        >
          {showLabels ? '\u25B2' : '\u25BC'} Бирки и этикетки
        </button>
        {showLabels && <LabelConfigurator />}
      </div>

      {/* ── Заметки по дизайну ── */}
      <div className={`section-label ${styles.sectionSpaced}`}>Заметки по дизайну</div>
      <div className="label-field full">
        <textarea
          placeholder="Описание дизайна, ссылки на макеты, пожелания..."
          value={designNotes}
          onChange={e => setField('designNotes', e.target.value)}
          rows={3}
        />
      </div>

      {/* ── Папка с макетами ── */}
      <div className={`section-label ${styles.sectionSpaced}`}>Папка с макетами</div>
      <div className="label-field full">
        <input
          type="text"
          placeholder="\\server\files\PH-0042"
          value={artworkPath}
          onChange={e => setArtworkPath(e.target.value)}
          className={styles.pathInput}
        />
        {artworkPath && (
          <button
            onClick={() => { navigator.clipboard.writeText(artworkPath); toast.success('Путь скопирован'); }}
            className={`btn ${styles.copyPathBtn}`}
          >
            Скопировать путь
          </button>
        )}
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
              <div className={`warning-banner ${styles.warningBanner}`}>
                <div className={styles.warningText}>⚠ Шелкография — минимальный тираж от 50 шт. Сейчас: {totalQty} шт.</div>
                <label className={styles.warningCheck}>
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
