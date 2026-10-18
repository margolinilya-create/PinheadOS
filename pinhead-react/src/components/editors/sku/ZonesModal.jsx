import { useStore } from '../../../store/useStore';
import { getAvailableZonesForSku } from '../../../utils/skuRules';
import { Modal } from '../../../erp/components/Modal';
import { Button } from '../../../erp/components/Button';
import ZoneChecks from './ZoneChecks';
import m from './SkuModal.module.css';

/** Зоны нанесения модели — правка применяется сразу, «Готово» закрывает */
export default function ZonesModal({ skuItem, skuIndex, updateSku, onClose }) {
  const zonesCatalog = useStore((s) => s.zonesCatalog);
  const availableZones = getAvailableZonesForSku(zonesCatalog, skuItem?.category || '');
  const toggle = (id) => {
    const zones = skuItem.zones || [];
    updateSku(skuIndex, 'zones', zones.includes(id) ? zones.filter(x => x !== id) : [...zones, id]);
  };

  return (
    <Modal title="Зоны нанесения" onClose={onClose} className={m.narrow}>
      <p className={m.hint}>{skuItem?.name}</p>
      <ZoneChecks zones={availableZones} selected={skuItem?.zones || []} onToggle={toggle} label="Зоны нанесения модели" />
      <div className={m.actions}>
        <Button variant="primary" onClick={onClose}>Готово</Button>
      </div>
    </Modal>
  );
}
