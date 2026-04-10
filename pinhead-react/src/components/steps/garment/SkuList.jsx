import { useRef, useState, useDeferredValue } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../../../lib/supabase';
import { storageSet } from '../../../lib/storage';
import { SKU_CATEGORIES } from '../../../data';
import { ZONE_LABELS } from '../../../data/constants';
import { getSkuEstPrice } from '../../../utils/pricing';
import { getGarmentSVG } from '../../../utils/mockup';

const FIT_OPTIONS = [
  { key: 'all', label: 'Все фиты' },
  { key: 'classic', label: 'Classic' },
  { key: 'regular', label: 'Regular' },
  { key: 'free', label: 'Free' },
  { key: 'oversize', label: 'Oversize' },
];

function SkuPhoto({ s, size = 44 }) {
  const photo = s.photos?.[0] || s.photoUrl;
  if (photo) return <img src={photo} alt={s.name} style={{ width: size, height: size }} />;
  const svg = getGarmentSVG(s.mockupType, '#d9d9d9');
  if (svg) return <div className="garment-row-photo-mockup" dangerouslySetInnerHTML={{ __html: svg }} />;
  return <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.2 }}>
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
  </svg>;
}

function PhotoLightbox({ photos, startIdx, onClose }) {
  const [idx, setIdx] = useState(startIdx);
  const handleKey = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowRight') setIdx(i => (i + 1) % photos.length);
    if (e.key === 'ArrowLeft') setIdx(i => (i - 1 + photos.length) % photos.length);
  };
  return (
    <div className="photo-lightbox" onClick={onClose} onKeyDown={handleKey} tabIndex={0} ref={el => el?.focus()}>
      <div className="photo-lightbox-content" onClick={e => e.stopPropagation()}>
        <img src={photos[idx]} alt={`Фото ${idx + 1}`} />
        {photos.length > 1 && (
          <>
            <button className="photo-lightbox-prev" onClick={() => setIdx(i => (i - 1 + photos.length) % photos.length)} aria-label="Предыдущее">&#8249;</button>
            <button className="photo-lightbox-next" onClick={() => setIdx(i => (i + 1) % photos.length)} aria-label="Следующее">&#8250;</button>
            <span className="photo-lightbox-counter">{idx + 1} / {photos.length}</span>
          </>
        )}
        <button className="photo-lightbox-close" onClick={onClose} aria-label="Закрыть">&#10005;</button>
      </div>
    </div>
  );
}

function ExpandPanel({ s, fabricsCatalog, trimCatalog, usdRate, onSelect }) {
  const photos = s.photos || (s.photoUrl ? [s.photoUrl] : []);
  const [lightbox, setLightbox] = useState(null);
  const est = getSkuEstPrice(s, null, fabricsCatalog, trimCatalog, usdRate);
  const mockupSvg = photos.length === 0 ? getGarmentSVG(s.mockupType, '#d9d9d9') : '';

  return (
    <div className="garment-expand-inner">
      {/* Photos gallery */}
      <div className="garment-expand-photos">
        {photos.length > 0 ? (
          <>
            <div className="garment-expand-photo main" onClick={() => setLightbox(0)} style={{ cursor: 'pointer' }}><img src={photos[0]} alt={s.name} /></div>
            {photos.slice(1).map((url, i) => (
              <div key={i} className="garment-expand-photo" onClick={() => setLightbox(i + 1)} style={{ cursor: 'pointer' }}><img src={url} alt={`${s.name} ${i + 2}`} /></div>
            ))}
          </>
        ) : (
          <div className="garment-expand-photo main">
            {mockupSvg
              ? <div className="garment-expand-photo-mockup" dangerouslySetInnerHTML={{ __html: mockupSvg }} />
              : <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.15 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                </svg>
            }
          </div>
        )}
      </div>

      {/* Info */}
      <div className="garment-expand-info">
        <div className="garment-expand-title">{s.name}</div>
        <div className="garment-expand-subtitle">{s.code} · {s.fit ? s.fit + ' fit' : ''}</div>

        {s.description && (
          <div className="garment-expand-desc">{s.description}</div>
        )}

        {s.sizeChart && (
          <>
            <div className="garment-expand-label">Табель мер (см)</div>
            <table className="garment-expand-size-table">
              <thead>
                <tr>{s.sizeChart.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {s.sizeChart.rows.map((row, ri) => (
                  <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {s.zones?.length > 0 && (
          <>
            <div className="garment-expand-label">Зоны нанесения</div>
            <div className="garment-expand-zones">
              {s.zones.map(z => (
                <span key={z} className="garment-expand-zone">{ZONE_LABELS[z] || z}</span>
              ))}
            </div>
          </>
        )}

        <div>
          <span className="garment-expand-price">от {est.toLocaleString('ru-RU')} ₽</span>
          <button className="garment-expand-select" onClick={e => { e.stopPropagation(); onSelect(s); }}>Выбрать</button>
        </div>
      </div>
      {lightbox !== null && photos.length > 0 && (
        <PhotoLightbox photos={photos} startIdx={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
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
  const [expandedCode, setExpandedCode] = useState(null);
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

  const handleRowClick = (s) => {
    setExpandedCode(prev => prev === s.code ? null : s.code);
  };

  const handleSelect = (s) => {
    selectSku(s);
    setExpandedCode(null);
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
                const isExpanded = expandedCode === s.code;
                return (
                  <div key={s.code}>
                    <div
                      className={`garment-row${isSelected ? ' selected' : ''}${isExpanded ? ' expanded' : ''}${dragOver === s.code ? ' drag-target' : ''}`}
                      draggable
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      aria-expanded={isExpanded}
                      onDragStart={e => onDragStart(e, s.code)}
                      onDragEnd={onDragEnd}
                      onDragOver={e => onDragOverRow(e, s.code)}
                      onDragLeave={onDragLeaveRow}
                      onDrop={e => onDropRow(e, s.code)}
                      onClick={() => handleRowClick(s)}
                      onDoubleClick={() => handleSelect(s)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleSelect(s); }
                        if (e.key === ' ') { e.preventDefault(); handleRowClick(s); }
                      }}
                    >
                      <div className="garment-row-photo">
                        <SkuPhoto s={s} />
                      </div>
                      <div className="garment-row-info">
                        <div className="garment-row-name">{s.name}</div>
                        <div className="garment-row-meta">
                          {s.fit || '—'} · {(s.zones || []).length} зон{s.shortDesc ? ' · ' + s.shortDesc : s.description ? ' · ' + s.description.slice(0, 40) : ''}
                        </div>
                      </div>
                      <span className="garment-row-price">от {est.toLocaleString('ru-RU')} ₽</span>
                      <span className="garment-row-chevron">▼</span>
                    </div>
                    <div className={`garment-expand${isExpanded ? ' open' : ''}`}>
                      {isExpanded && (
                        <ExpandPanel
                          s={s}
                          fabricsCatalog={fabricsCatalog}
                          trimCatalog={trimCatalog}
                          usdRate={usdRate}
                          onSelect={handleSelect}
                        />
                      )}
                    </div>
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
