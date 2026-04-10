import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { useFocusTrap } from '../../../hooks/useFocusTrap';

export default function AddSkuModal({ addForm, setAddForm, onAdd, onClose }) {
  const panelRef = useFocusTrap(true, onClose);

  return (
    <div className="sku-modal-overlay" onClick={onClose}>
      <div className="sku-modal" ref={panelRef} role="dialog" aria-modal="true" aria-label="Добавить изделие" onClick={e => e.stopPropagation()}>
        <h3>Добавить изделие</h3>
        <div className="sku-modal-field">
          <label htmlFor="sku-add-name">НАЗВАНИЕ</label>
          <input id="sku-add-name" value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })}
            placeholder="Название изделия" autoFocus />
        </div>
        <div className="sku-modal-field">
          <label htmlFor="sku-add-category">КАТЕГОРИЯ</label>
          <select id="sku-add-category" value={addForm.category} onChange={e => setAddForm({ ...addForm, category: e.target.value })}>
            {SKU_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {addForm.category !== 'accessories' && (
          <div className="sku-modal-field">
            <label htmlFor="sku-add-fit">FIT</label>
            <select id="sku-add-fit" value={addForm.fit} onChange={e => setAddForm({ ...addForm, fit: e.target.value })}>
              <option value="regular">Regular</option>
              <option value="free">Free</option>
              <option value="oversize">Oversize</option>
            </select>
          </div>
        )}
        <div className="sku-modal-btns">
          <button className="btn-secondary" onClick={onClose}>Отмена</button>
          <button className="btn-accent" onClick={onAdd} disabled={!addForm.name.trim()}>Добавить</button>
        </div>
      </div>
    </div>
  );
}
