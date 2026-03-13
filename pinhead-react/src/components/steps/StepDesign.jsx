import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { ZONE_LABELS } from '../../data';
import { TECH_TABS, getZoneSurcharge, hasNoPrint } from '../../utils/pricing';
import ZoneTechBlock from './ZoneTechBlock';
import LabelConfigurator from './LabelConfigurator';

export default function StepDesign() {
  const { sku, type, zones, toggleZone, noPrint, toggleNoPrint, designNotes, setField, nextStep, prevStep,
    sizes, customSizes, zoneTechs } = useStore();
  const [screenConfirmed, setScreenConfirmed] = useState(false);

  if (!sku) {
    return <div className="step-panel"><div className="empty-state">Сначала выберите изделие</div></div>;
  }

  const availableZones = sku.zones || [];
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
          <div className="zones-grid">
            {availableZones.map(z => (
              <div
                key={z}
                className={`zone-card${zones.includes(z) ? ' selected' : ''}`}
                onClick={() => toggleZone(z)}
              >
                <div className="zone-bar" />
                <div className="zone-card-inner">
                  <div className="zone-label">{ZONE_LABELS[z] || z}</div>
                </div>
                <div className="zone-check">{zones.includes(z) ? '✓' : ''}</div>
              </div>
            ))}
          </div>

          <div className="no-print-wrap">
            <button className={`no-print-btn${noPrint ? ' active' : ''}`} onClick={toggleNoPrint}>
              <span className="no-print-check">{noPrint ? '✓' : ''}</span>
              Без нанесения
            </button>
          </div>

          {zones.length > 0 && !noPrint && (
            <>
              <div className="section-label" style={{ marginTop: 24 }}>Техника нанесения по зонам</div>
              <div className="zone-tech-blocks">
                {zones.map(z => <ZoneTechBlock key={z} zone={z} />)}
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
