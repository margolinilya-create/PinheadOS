import { SKU_CATEGORIES } from '../../../data/skuCatalog';

export default function AddSkuModal({ addForm, setAddForm, onAdd, onClose }) {
  return (
    <div className="sku-modal-overlay" onClick={onClose}>
      <div className="sku-modal" onClick={e => e.stopPropagation()}>
        <h3>Добавить изделие</h3>
        <div className="sku-modal-field">
          <label>НАЗВАНИЕ</label>
          <input value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })}
            placeholder="Название изделия" autoFocus />
        </div>
        <div className="sku-modal-field">
          <label>КАТЕГОРИЯ</label>
          <select value={addForm.category} onChange={e => setAddForm({ ...addForm, category: e.target.value })}>
            {SKU_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {addForm.category !== 'accessories' && (
          <div className="sku-modal-field">
            <label>FIT</label>
            <select value={addForm.fit} onChange={e => setAddForm({ ...addForm, fit: e.target.value })}>
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
