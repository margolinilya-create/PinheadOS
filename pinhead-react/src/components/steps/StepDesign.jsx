import { useStore } from '../../store/useStore';
import { ZONE_LABELS } from '../../data';
import { TECH_TABS, getZoneSurcharge, hasNoPrint } from '../../utils/pricing';
import ZoneTechBlock from './ZoneTechBlock';

export default function StepDesign() {
  const { sku, type, zones, toggleZone, noPrint, toggleNoPrint, nextStep, prevStep } = useStore();
  const state = useStore();

  if (!sku) {
    return <div className="step-panel"><div className="empty-state">Сначала выберите изделие</div></div>;
  }

  const availableZones = sku.zones || [];
  const noPrintType = hasNoPrint(type);

  return (
    <div className="step-panel">
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
                <div className="zone-check">{zones.includes(z) ? '✓' : ''}</div>
                <div className="zone-name">{ZONE_LABELS[z] || z}</div>
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
            <div className="zone-tech-blocks">
              {zones.map(z => <ZoneTechBlock key={z} zone={z} />)}
            </div>
          )}
        </>
      )}

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>← Назад</button>
        <button className={`btn-next${!noPrint && !noPrintType && zones.length === 0 ? ' disabled' : ''}`}
          onClick={() => (noPrint || noPrintType || zones.length > 0) && nextStep()}>
          Далее — Детали →
        </button>
      </div>
    </div>
  );
}
