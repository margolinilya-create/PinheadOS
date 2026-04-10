import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { ZONE_LABELS } from '../../../data/constants';
import SkuDetailModal from './SkuDetailModal';

export default function SkuItemsTab({
  search, setSearch, catFilter, setCatFilter,
  filteredSku, groupedSku, skuCatalog, trimCatalog,
  updateSku, deleteSku, estimatePrice, setShowAddModal, setShowZonesModal, onPersist,
}) {
  const [detailIdx, setDetailIdx] = useState(null);
  const getCatName = (id) => SKU_CATEGORIES.find(c => c.id === id)?.name || id;

  return (
    <div className="sku-ed-body">
      <div className="sku-ed-toolbar">
        <input className="page-search" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="sku-ed-cat-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">Все категории</option>
          {SKU_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="sku-ed-count">Всего: {filteredSku.length} SKU</span>
        <button className="sku-ed-add-btn" onClick={() => setShowAddModal(true)}>+ Добавить</button>
      </div>

      {Object.entries(groupedSku).map(([cat, items]) => (
        <div key={cat} className="sku-ed-group">
          <div className="sku-ed-group-header">
            <span>{getCatName(cat)}</span>
            <span className="sku-ed-group-count">{items.length}</span>
          </div>
          <table className="sku-ed-table">
            <thead>
              <tr>
                <th className="sku-th-num">№</th>
                <th className="sku-th-photo"></th>
                <th className="sku-th-art">Артикул</th>
                <th className="sku-th-name">Название</th>
                <th className="sku-th-fit">Fit</th>
                <th className="sku-th-price">Пошив</th>
                <th className="sku-th-num2">Осн</th>
                <th className="sku-th-num2">Отд</th>
                <th className="sku-th-trim">Отделка</th>
                <th className="sku-th-zones">Зоны</th>
                <th className="sku-th-est">Цена</th>
                <th className="sku-th-del"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const realIdx = skuCatalog.indexOf(s);
                return (
                  <tr key={s.code}>
                    <td className="sku-td-num">{realIdx + 1}</td>
                    <td className="sku-td-photo">
                      <button className="sku-photo-thumb" onClick={() => setDetailIdx(realIdx)} title="Редактировать">
                        {s.photos?.[0] ? (
                          <img src={s.photos[0]} alt={s.name} />
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                        )}
                      </button>
                    </td>
                    <td className="sku-td-art">{s.code}</td>
                    <td>
                      <input className="sku-edit-input sku-edit-name" value={s.name}
                        onChange={e => updateSku(realIdx, 'name', e.target.value)} />
                    </td>
                    <td>
                      {s.fit !== null ? (
                        <select className="sku-edit-select" value={s.fit || 'regular'}
                          onChange={e => updateSku(realIdx, 'fit', e.target.value)}>
                          <option value="regular">regular</option>
                          <option value="free">free</option>
                          <option value="oversize">oversize</option>
                        </select>
                      ) : <span className="sku-td-dim">—</span>}
                    </td>
                    <td>
                      <input className="sku-edit-input sku-edit-num" type="number" value={s.sewingPrice}
                        onChange={e => updateSku(realIdx, 'sewingPrice', Number(e.target.value) || 0)} />
                    </td>
                    <td>
                      <input className="sku-edit-input sku-edit-num" type="number" step="0.1" value={s.mainFabricUsage}
                        onChange={e => updateSku(realIdx, 'mainFabricUsage', Number(e.target.value) || 0)} />
                    </td>
                    <td>
                      <input className="sku-edit-input sku-edit-num" type="number" step="0.01" value={s.trimUsage || 0}
                        onChange={e => updateSku(realIdx, 'trimUsage', Number(e.target.value) || 0)} />
                    </td>
                    <td>
                      <select className="sku-edit-select" value={s.trimCode || ''}
                        onChange={e => updateSku(realIdx, 'trimCode', e.target.value || null)}>
                        <option value="">—</option>
                        {trimCatalog.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <button className="sku-zones-btn" onClick={() => setShowZonesModal(realIdx)}>
                        {(s.zones || []).length > 0
                          ? (s.zones || []).map(z => ZONE_LABELS[z] || z).join(', ')
                          : '—'}
                      </button>
                    </td>
                    <td className="sku-td-est">от {estimatePrice(s)} ₽</td>
                    <td>
                      <button className="sku-del-btn" onClick={() => deleteSku(realIdx)} aria-label="Удалить SKU">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {detailIdx !== null && skuCatalog[detailIdx] && (
        <SkuDetailModal
          sku={skuCatalog[detailIdx]}
          skuIndex={detailIdx}
          onUpdate={updateSku}
          onClose={() => setDetailIdx(null)}
          onPersist={onPersist}
        />
      )}
    </div>
  );
}
