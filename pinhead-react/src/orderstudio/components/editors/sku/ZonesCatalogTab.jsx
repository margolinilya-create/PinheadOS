import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../../data/skuCatalog';
import { toast } from '../../../../store/useToastStore';

export default function ZonesCatalogTab({ zonesCatalog, skuCatalog, onUpdate }) {
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');

  const addZone = () => {
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '');
    if (!id) { toast.error('ID зоны не может быть пустым'); return; }
    if (zonesCatalog.some(z => z.id === id)) { toast.error(`Зона «${id}» уже существует`); return; }
    const sortOrder = zonesCatalog.length > 0 ? Math.max(...zonesCatalog.map(z => z.sortOrder ?? 0)) + 1 : 1;
    onUpdate([...zonesCatalog, { id, name: newName.trim() || id, forCategories: null, sortOrder }]);
    setNewId('');
    setNewName('');
    toast.success('Зона добавлена');
  };

  const removeZone = (zoneId) => {
    const usedBy = (skuCatalog || []).filter(s => (s.zones || []).includes(zoneId));
    if (usedBy.length > 0 && !window.confirm(`Зона "${zoneId}" используется в ${usedBy.length} SKU. Удалить?`)) return;
    onUpdate(zonesCatalog.filter(z => z.id !== zoneId));
    toast.success('Зона удалена');
  };

  const updateZone = (idx, field, value) => {
    onUpdate(zonesCatalog.map((z, i) => i === idx ? { ...z, [field]: value } : z));
  };

  const toggleCategory = (idx, catId) => {
    const zone = zonesCatalog[idx];
    const current = zone.forCategories || SKU_CATEGORIES.map(c => c.id);
    const next = current.includes(catId) ? current.filter(c => c !== catId) : [...current, catId];
    updateZone(idx, 'forCategories', next.length === SKU_CATEGORIES.length ? null : next);
  };

  return (
    <div className="cat-rules-tab">
      <div className="cat-rules-hint">
        Глобальный каталог зон нанесения. Добавляйте, переименовывайте или удаляйте зоны. Привязка к категориям определяет, какие зоны доступны для каких изделий.
      </div>

      <table className="zones-catalog-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Название</th>
            <th>Категории</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {zonesCatalog.map((z, idx) => (
            <tr key={z.id}>
              <td className="zones-id-cell">{z.id}</td>
              <td>
                <input
                  className="zones-name-input"
                  value={z.name}
                  onChange={e => updateZone(idx, 'name', e.target.value)}
                />
              </td>
              <td>
                <div className="zones-cat-chips">
                  {z.forCategories === null ? (
                    <button className="cat-rule-chip active" onClick={() => updateZone(idx, 'forCategories', SKU_CATEGORIES.map(c => c.id))}>
                      все
                    </button>
                  ) : (
                    SKU_CATEGORIES.map(c => {
                      const active = z.forCategories.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          className={`cat-rule-chip cat-rule-chip-sm${active ? ' active' : ''}`}
                          onClick={() => toggleCategory(idx, c.id)}
                          title={c.name}
                        >
                          {c.name.split(' ')[0].substring(0, 6)}
                        </button>
                      );
                    })
                  )}
                </div>
              </td>
              <td>
                <button className="sku-del-btn" onClick={() => removeZone(z.id)} aria-label="Удалить зону">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="zones-add-row">
        <input
          className="zones-add-input"
          placeholder="ID (латиница)"
          value={newId}
          onChange={e => setNewId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addZone()}
        />
        <input
          className="zones-add-input zones-add-name"
          placeholder="Название"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addZone()}
        />
        <button className="pe-btn pe-btn-primary" onClick={addZone} disabled={!newId.trim()}>+ Добавить</button>
      </div>
    </div>
  );
}
