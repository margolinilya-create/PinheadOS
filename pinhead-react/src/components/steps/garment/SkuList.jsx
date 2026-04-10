import { useRef, useState, useDeferredValue } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../../../lib/supabase';
import { storageSet } from '../../../lib/storage';
import { SKU_CATEGORIES } from '../../../data';
import { getSkuEstPrice } from '../../../utils/pricing';

const FIT_OPTIONS = [
  { key: 'all', label: 'Все фиты' },
  { key: 'classic', label: 'Classic' },
  { key: 'regular', label: 'Regular' },
  { key: 'free', label: 'Free' },
  { key: 'oversize', label: 'Oversize' },
];

function CategoryIcon({ category }) {
  const icons = {
    tshirts: <path d="M6 4h12l-2 4H8L6 4zM8 8v12h8V8" />,
    longsleeves: <><path d="M6 4h12l-2 4H8L6 4zM8 8v12h8V8" /><path d="M4 6l4 2M20 6l-4 2" /></>,
    hoodies: <><path d="M6 4h12l-2 4H8L6 4zM8 8v12h8V8" /><path d="M10 4c0-1 2-2 2-2s2 1 2 2" /></>,
    pants: <path d="M8 4h8v8l2 8h-4l-2-6-2 6H6l2-8V4" />,
    shorts: <path d="M8 4h8v6l2 4h-4l-2-3-2 3H6l2-4V4" />,
    accessories: <><path d="M4 8h16v10H4V8z" /><path d="M8 8V6a4 4 0 018 0v2" /></>,
  };
  const d = icons[category] || icons.tshirts;
  return (
    <svg className="sku-cat-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

export default function SkuList() {
  const { skuCatalog, skuFilter, setSkuFilter, selectSku, reorderSku, sku, fabricsCatalog, trimCatalog, usdRate } = useStore(
    useShallow(s => ({ skuCatalog: s.skuCatalog, skuFilter: s.skuFilter, setSkuFilter: s.setSkuFilter,
      selectSku: s.selectSku, reorderSku: s.reorderSku, sku: s.sku, fabricsCatalog: s.fabricsCatalog,
      trimCatalog: s.trimCatalog, usdRate: s.usdRate }))
  );
  const dragRef = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const [fitFilter, setFitFilter] = useState('all');
  const [skuSearch, setSkuSearch] = useState('');
  const deferredSearch = useDeferredValue(skuSearch);
  const usedCats = [...new Set(skuCatalog.map(s => s.category))];
  const cats = SKU_CATEGORIES.filter(c => usedCats.includes(c.id));

  let filtered = skuFilter === 'all' ? skuCatalog : skuCatalog.filter(s => s.category === skuFilter);
  if (fitFilter !== 'all') {
    filtered = filtered.filter(s => s.fit === fitFilter);
  }
  const totalBeforeSearch = filtered.length;
  if (deferredSearch.trim()) {
    const q = deferredSearch.toLowerCase();
    filtered = filtered.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.code?.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q)
    );
  }

  const groups = {};
  filtered.forEach(s => { if (!groups[s.category]) groups[s.category] = []; groups[s.category].push(s); });
  const catOrder = SKU_CATEGORIES.map(c => c.id);

  const onDragStart = (e, code) => {
    dragRef.current = code;
    e.dataTransfer.effectAllowed = 'move';
    if (e.target && e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(e.target, 20, 20);
    }
  };
  const onDragEnd = () => { dragRef.current = null; setDragOver(null); };
  const onDragOverRow = (e, code) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(code); };
  const onDragLeaveRow = () => { setDragOver(null); };
  const onDropRow = (e, code) => {
    e.preventDefault();
    setDragOver(null);
    if (dragRef.current && dragRef.current !== code) {
      reorderSku(dragRef.current, code);
      try {
        const updated = useStore.getState().skuCatalog;
        storageSet('ph_sku', updated);
        supabase.from('app_config')
          .upsert({ key: 'sku_catalog', value: updated, updated_at: new Date().toISOString() })
          .then(() => {});
      } catch { /* ignore */ }
    }
  };

  return (
    <div className="sku-section">
      <div className="section-label">Изделие</div>
      <div className="sku-cat-filter">
        <button className={`sku-cat-pill${skuFilter === 'all' ? ' active' : ''}`} onClick={() => setSkuFilter('all')}>Все</button>
        {cats.map(c => (
          <button key={c.id} className={`sku-cat-pill${skuFilter === c.id ? ' active' : ''}`} onClick={() => setSkuFilter(c.id)}>{c.name}</button>
        ))}
      </div>
      <div className="sku-fit-filter">
        {FIT_OPTIONS.map(f => (
          <button key={f.key} className={`sku-fit-pill${fitFilter === f.key ? ' active' : ''}`} onClick={() => setFitFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className="sku-search-wrap">
        <input
          type="text"
          className="sku-search-input"
          placeholder="Поиск: футболка, худи, артикул..."
          value={skuSearch}
          onChange={e => setSkuSearch(e.target.value)}
        />
        {skuSearch && (
          <button className="sku-search-clear" onClick={() => setSkuSearch('')}>
            ✕
          </button>
        )}
      </div>
      {skuSearch.trim() && (
        <div className="sku-search-count">Найдено: {filtered.length} из {totalBeforeSearch}</div>
      )}
      <div className="garment-list">
        {Object.keys(groups).sort((a, b) => catOrder.indexOf(a) - catOrder.indexOf(b)).map(catId => {
          const cat = SKU_CATEGORIES.find(c => c.id === catId);
          return (
            <div key={catId}>
              <div className="garment-sep"><span className="garment-sep-text">{cat?.name || catId}</span><div className="garment-sep-line" /></div>
              {groups[catId].map(s => {
                const est = getSkuEstPrice(s, null, fabricsCatalog, trimCatalog, usdRate);
                const isSelected = sku?.code === s.code;
                return (
                  <div
                    key={s.code}
                    className={`garment-row${isSelected ? ' selected' : ''}${dragOver === s.code ? ' drag-target' : ''}`}
                    draggable
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onDragStart={e => onDragStart(e, s.code)}
                    onDragEnd={onDragEnd}
                    onDragOver={e => onDragOverRow(e, s.code)}
                    onDragLeave={onDragLeaveRow}
                    onDrop={e => onDropRow(e, s.code)}
                    onClick={() => selectSku(s)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSku(s); } }}
                  >
                    <div className="garment-row-bar" />
                    <CategoryIcon category={s.category} />
                    <span className="garment-row-name">{s.name}</span>
                    <span className="garment-row-price">от {est.toLocaleString('ru-RU')} ₽</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
