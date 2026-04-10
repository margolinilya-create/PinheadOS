import { useFocusTrap } from '../../../hooks/useFocusTrap';

const ALL_ZONES = [
  {id:'front', name:'Грудь (перед)'},
  {id:'back', name:'Спина'},
  {id:'sleeve-l', name:'Левый рукав'},
  {id:'sleeve-r', name:'Правый рукав'},
  {id:'hood', name:'Капюшон'},
  {id:'pocket', name:'Карман'},
  {id:'side-a', name:'Сторона A'},
  {id:'side-b', name:'Сторона B'},
];

export default function ZonesModal({ skuItem, skuIndex, updateSku, onClose }) {
  const panelRef = useFocusTrap(true, onClose);

  return (
    <div className="sku-modal-overlay" onClick={onClose}>
      <div className="sku-modal" ref={panelRef} role="dialog" aria-modal="true" aria-label="Зоны нанесения" onClick={e => e.stopPropagation()}>
        <h3>Зоны нанесения</h3>
        <p className="sku-modal-hint">{skuItem?.name}</p>
        <div className="sku-zones-grid">
          {ALL_ZONES.filter(z => {
            const cat = skuItem?.category;
            if (cat === 'accessories') return ['side-a', 'side-b'].includes(z.id);
            return !['side-a', 'side-b'].includes(z.id);
          }).map(z => {
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
