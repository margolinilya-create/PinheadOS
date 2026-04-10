import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { confirm } from '../../../store/useConfirmStore';

export default function ExtrasEditor({ extras, onUpdate, onAdd, onDelete, onToggleCat }) {
  const [mode, setMode] = useState('by-category');
  const [selectedCat, setSelectedCat] = useState('tshirts');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState(30);

  const handleAdd = () => {
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
    <div className="sku-ed-body">
      <div className="sku-ed-toolbar">
        <div className="extras-mode-switch">
          <button className={`extras-mode-btn${mode === 'by-category' ? ' active' : ''}`} onClick={() => setMode('by-category')}>По категории</button>
          <button className={`extras-mode-btn${mode === 'by-extra' ? ' active' : ''}`} onClick={() => setMode('by-extra')}>По обработке</button>
        </div>
        <span className="sku-ed-count">Всего: {extras.length} обработок</span>
      </div>

      {/* ── Mode A: By Category ── */}
      {mode === 'by-category' && (
        <>
          <div className="extras-cat-tabs">
            {SKU_CATEGORIES.map(c => (
              <button key={c.id} className={`extras-cat-tab${selectedCat === c.id ? ' active' : ''}`} onClick={() => setSelectedCat(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="extras-editor-list">
            {extras.map((e, i) => {
              const enabled = (e.forCategories || []).includes(selectedCat);
              return (
                <div key={e.code + i} className={`extras-list-item${!enabled ? ' disabled' : ''}`} onClick={() => onToggleCat(i, selectedCat)}>
                  <div className={`extras-check${enabled ? ' checked' : ''}`}>
                    {enabled && <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                  <span className="extras-item-name">{e.name}</span>
                  <span className="extras-price">{e.price} ₽</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Mode B: By Extra ── */}
      {mode === 'by-extra' && (
        <>
          <div className="extras-nav-bar">
            <button className="extras-nav-btn" disabled={selectedIdx <= 0} onClick={() => setSelectedIdx(selectedIdx - 1)}>← Пред</button>
            <span className="extras-nav-label">{current ? `${selectedIdx + 1} / ${extras.length}` : '—'}</span>
            <button className="extras-nav-btn" disabled={selectedIdx >= extras.length - 1} onClick={() => setSelectedIdx(selectedIdx + 1)}>След →</button>
          </div>
          {current && (
            <div className="extras-detail">
              <div className="extras-detail-header">
                <input className="sku-edit-input sku-edit-name" value={current.name} onChange={e => onUpdate(selectedIdx, 'name', e.target.value)} />
                <div className="extras-detail-price">
                  <span className="extras-detail-price-label">Цена:</span>
                  <input className="sku-edit-input sku-edit-num" type="number" value={current.price} onChange={e => onUpdate(selectedIdx, 'price', Number(e.target.value) || 0)} />
                  <span>₽</span>
                </div>
                <button className="sku-del-btn" onClick={() => handleDelete(selectedIdx)} title="Удалить обработку" aria-label="Удалить обработку">✕</button>
              </div>
              <div className="extras-detail-cats">
                <span className="extras-detail-cats-label">Категории:</span>
                {SKU_CATEGORIES.map(c => {
                  const enabled = (current.forCategories || []).includes(c.id);
                  return (
                    <div key={c.id} className={`extras-list-item${!enabled ? ' disabled' : ''}`} onClick={() => onToggleCat(selectedIdx, c.id)}>
                      <div className={`extras-check${enabled ? ' checked' : ''}`}>
                        {enabled && <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </div>
                      <span className="extras-item-name">{c.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Add Extra Form ── */}
      {showAddForm ? (
        <div className="extras-add-form">
          <input className="sku-edit-input" placeholder="Название обработки" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
          <input className="sku-edit-input sku-edit-num" type="number" placeholder="Цена" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
          <button className="pe-btn pe-btn-primary" onClick={handleAdd} disabled={!newName.trim()}>Добавить</button>
          <button className="pe-btn" onClick={() => setShowAddForm(false)}>Отмена</button>
        </div>
      ) : (
        <button className="sku-ed-add-btn" style={{ marginTop: 12 }} onClick={() => setShowAddForm(true)}>+ Добавить обработку</button>
      )}
    </div>
  );
}
