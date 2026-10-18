import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { confirm } from '../../../store/useConfirmStore';
import { Button } from '../../../erp/components/Button';
import a11y from '../../../orderstudio/ui/a11y.module.css';
import t from './skuTable.module.css';
import x from './Extras.module.css';

const MODES = [['by-category', 'По категории'], ['by-extra', 'По обработке']];

/** Флажок «обработка доступна категории» — подпись связана с контролом, работает с клавиатуры */
function CatCheck({ checked, onChange, children, price }) {
  return (
    <label className={x.item}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className={x.name}>{children}</span>
      {price !== undefined && <span className={x.price}>{price} ₽</span>}
    </label>
  );
}

/**
 * Вкладка «Обработки»: какие обработки доступны каким категориям — двумя
 * взглядами («по категории» и «по обработке»), цена за штуку.
 */
export default function ExtrasEditor({ extras, onUpdate, onAdd, onDelete, onToggleCat, readOnly = false }) {
  const [mode, setMode] = useState('by-category');
  const [selectedCat, setSelectedCat] = useState('tshirts');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState(30);

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAdd();
    const idx = extras.length;
    setTimeout(() => {
      onUpdate(idx, 'name', newName.trim());
      onUpdate(idx, 'price', Number(newPrice) || 0);
    }, 0);
    setNewName('');
    setNewPrice(30);
    setShowAddForm(false);
  };

  const handleDelete = async (idx) => {
    const ok = await confirm({ title: `Удалить «${extras[idx]?.name}»?`, variant: 'danger', confirmLabel: 'Удалить' });
    if (!ok) return;
    onDelete(idx);
    if (selectedIdx >= extras.length - 1) setSelectedIdx(Math.max(0, extras.length - 2));
  };

  const current = extras[selectedIdx] || null;

  return (
    <div className={t.body}>
      <div className={t.toolbar}>
        <div className={t.chips} role="group" aria-label="Вид списка">
          {MODES.map(([id, label]) => (
            <button key={id} type="button" className={t.chip} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>
          ))}
        </div>
        <span className={t.count}>Обработок: {extras.length}</span>
      </div>

      {mode === 'by-category' && (
        <>
          <div className={`${t.chips} ${x.cats}`} role="group" aria-label="Категория">
            {SKU_CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={t.chip} aria-pressed={selectedCat === c.id}
                onClick={() => setSelectedCat(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          <fieldset className={`${t.fieldset} ${x.list}`} disabled={readOnly}>
            <legend className={a11y.srOnly}>
              Обработки категории «{SKU_CATEGORIES.find((c) => c.id === selectedCat)?.name}»
            </legend>
            {extras.map((e, i) => (
              <CatCheck key={e.code + i} checked={(e.forCategories || []).includes(selectedCat)}
                onChange={() => onToggleCat(i, selectedCat)} price={e.price}>
                {e.name}
              </CatCheck>
            ))}
          </fieldset>
        </>
      )}

      {mode === 'by-extra' && (
        <>
          <div className={x.nav}>
            <Button icon="chevronLeft" disabled={selectedIdx <= 0} onClick={() => setSelectedIdx(selectedIdx - 1)}>Предыдущая</Button>
            <span className={t.count} aria-live="polite">{current ? `${selectedIdx + 1} из ${extras.length}` : '—'}</span>
            <Button icon="chevronRight" disabled={selectedIdx >= extras.length - 1} onClick={() => setSelectedIdx(selectedIdx + 1)}>Следующая</Button>
          </div>
          {current && (
            <fieldset className={`${t.fieldset} ${x.detail}`} disabled={readOnly}>
              <legend className={a11y.srOnly}>Обработка «{current.name}»</legend>
              <div className={x.detailHead}>
                <label className={x.field}>
                  <span className={x.label}>Название</span>
                  <input className={x.input} value={current.name} onChange={(e) => onUpdate(selectedIdx, 'name', e.target.value)} />
                </label>
                <label className={x.field}>
                  <span className={x.label}>Цена, ₽</span>
                  <input className={`${x.input} ${x.num}`} type="number" value={current.price}
                    onChange={(e) => onUpdate(selectedIdx, 'price', Number(e.target.value) || 0)} />
                </label>
                <Button variant="ghost" icon="trash" onClick={() => handleDelete(selectedIdx)}>Удалить обработку</Button>
              </div>
              <div className={x.list} role="group" aria-label="Категории обработки">
                {SKU_CATEGORIES.map((c) => (
                  <CatCheck key={c.id} checked={(current.forCategories || []).includes(c.id)}
                    onChange={() => onToggleCat(selectedIdx, c.id)}>
                    {c.name}
                  </CatCheck>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}

      {!readOnly && (showAddForm ? (
        <form className={x.addForm} onSubmit={handleAdd}>
          <label className={x.field}>
            <span className={x.label}>Название обработки</span>
            <input className={x.input} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </label>
          <label className={x.field}>
            <span className={x.label}>Цена, ₽</span>
            <input className={`${x.input} ${x.num}`} type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={!newName.trim()}>Добавить</Button>
          <Button onClick={() => setShowAddForm(false)}>Отмена</Button>
        </form>
      ) : (
        <div className={x.addRow}>
          <Button icon="plus" onClick={() => setShowAddForm(true)}>Добавить обработку</Button>
        </div>
      ))}
    </div>
  );
}
