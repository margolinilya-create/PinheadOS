import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { Modal } from '../../../erp/components/Modal';
import { Button } from '../../../erp/components/Button';
import m from './SkuModal.module.css';

/** «Добавить модель» каталога: форма ввода не закрывается промахом мимо окна */
export default function AddSkuModal({ addForm, setAddForm, onAdd, onClose }) {
  const set = (patch) => setAddForm({ ...addForm, ...patch });
  return (
    <Modal title="Добавить модель" onClose={onClose} closeOnOverlay={false} className={m.narrow}>
      <form
        className={m.form}
        onSubmit={(e) => { e.preventDefault(); if (addForm.name.trim()) onAdd(); }}
      >
        <div className={m.field}>
          <label htmlFor="sku-add-name" className={m.label}>Название</label>
          <input id="sku-add-name" className={m.input} value={addForm.name}
            onChange={e => set({ name: e.target.value })} placeholder="Например, Футболка оверсайз" autoFocus />
        </div>
        <div className={m.field}>
          <label htmlFor="sku-add-category" className={m.label}>Категория</label>
          <select id="sku-add-category" className={m.input} value={addForm.category}
            onChange={e => set({ category: e.target.value })}>
            {SKU_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {addForm.category !== 'accessories' && (
          <div className={m.field}>
            <label htmlFor="sku-add-fit" className={m.label}>Fit</label>
            <select id="sku-add-fit" className={m.input} value={addForm.fit} onChange={e => set({ fit: e.target.value })}>
              <option value="regular">Regular</option>
              <option value="free">Free</option>
              <option value="oversize">Oversize</option>
            </select>
          </div>
        )}
        <div className={m.actions}>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!addForm.name.trim()}>Добавить модель</Button>
        </div>
      </form>
    </Modal>
  );
}
