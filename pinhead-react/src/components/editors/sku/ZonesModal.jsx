import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { getAvailableZonesForSku } from '../../../utils/skuRules';

export default function ZonesModal({ skuItem, skuIndex, updateSku, onClose }) {
  const panelRef = useFocusTrap(true, onClose);
  const zonesCatalog = useStore(useShallow(s => s.zonesCatalog));
  const availableZones = getAvailableZonesForSku(zonesCatalog, skuItem?.category || '');

  return (
    <div className="sku-modal-overlay" onClick={onClose}>
      <div className="sku-modal" ref={panelRef} role="dialog" aria-modal="true" aria-label="Зоны нанесения" onClick={e => e.stopPropagation()}>
        <h3>Зоны нанесения</h3>
        <p className="sku-modal-hint">{skuItem?.name}</p>
        <div className="sku-zones-grid">
          {availableZones.map(z => {
            const active = (skuItem?.zones || []).includes(z.id);
            return (
              <label key={z.id} className={`sku-zone-check${active ? ' active' : ''}`}>
                <input type="checkbox" checked={active}
                  onChange={() => {
                    const zones = skuItem.zones || [];
                    const newZones = active ? zones.filter(x => x !== z.id) : [...zones, z.id];
                    updateSku(skuIndex, 'zones', newZones);
                  }} />
                <span>{z.name}</span>
              </label>
            );
          })}
        </div>
        <div className="sku-modal-btns">
          <button className="btn-accent" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
