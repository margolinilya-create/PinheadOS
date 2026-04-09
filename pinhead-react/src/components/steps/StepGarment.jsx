import { useRef, useState, useDeferredValue } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../../lib/supabase';
import { storageSet } from '../../lib/storage';
import { SKU_CATEGORIES } from '../../data';
import { MEDASTEX_COLORS, COLOR_GROUPS, COTTONPROM_COLORS, COTTONPROM_GROUPS, SIZES } from '../../data';
import { FABRICS_CATALOG_DEFAULT, LAYER1_TYPES } from '../../data';
import { EXTRAS_DESCS, EXTRAS_GROUPS } from '../../data';
import { getSkuEstPrice, isAccessory, getTotalQty, getUnitPrice, calcExtrasCost } from '../../utils/pricing';
import { sizeOrder } from '../../store/slices/helpers';
import { getGarmentSVG } from '../../utils/mockup';

// ── SKU List ──
const FIT_OPTIONS = [
  { key: 'all', label: 'Все фиты' },
  { key: 'classic', label: 'Classic' },
  { key: 'regular', label: 'Regular' },
  { key: 'free', label: 'Free' },
  { key: 'oversize', label: 'Oversize' },
];

function SkuList() {
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
    // Уменьшить ghost-image для наглядности
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
      // Сохранить новый порядок в localStorage + Supabase
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

// ── Fabric Grid ──
function FabricGrid() {
  const { type, fabric, selectFabric, setColorSupplier, sku, fabricsCatalog, colorSupplier, usdRate } = useStore(
    useShallow(s => ({ type: s.type, fabric: s.fabric, selectFabric: s.selectFabric, setColorSupplier: s.setColorSupplier,
      sku: s.sku, fabricsCatalog: s.fabricsCatalog, colorSupplier: s.colorSupplier, usdRate: s.usdRate }))
  );
  if (isAccessory(type)) return null;

  let fabrics;
  let catalogFabrics = [];
  if (sku?.category) {
    catalogFabrics = fabricsCatalog.filter(f => (f.forCategories || []).includes(sku.category));
    if (catalogFabrics.length > 0) {
      fabrics = catalogFabrics.map(f => ({ key: f.code, name: f.name, meta: [f.composition, f.density ? f.density + ' г/м²' : null].filter(Boolean).join(' · '), sub: Math.round(f.priceUSD * usdRate) + ' ₽/м · ' + f.supplier, supplier: f.supplier }));
    }
  }
  if (!fabrics) {
    // Fallback: derive fabric options from FABRICS_CATALOG_DEFAULT by layer type
    const layerCats = LAYER1_TYPES.includes(type)
      ? LAYER1_TYPES
      : ['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts','bombers'];
    const fallbackFabrics = FABRICS_CATALOG_DEFAULT.filter(f =>
      (f.forCategories || []).some(c => layerCats.includes(c)));
    fabrics = fallbackFabrics.map(f => ({ key: f.code, name: f.name, meta: f.composition + (f.density ? ' ' + f.density + ' г/м²' : ''), sub: f.supplier, priceKey: f.code }));
  }

  if (!fabrics.length) return null;

  const handleSelectFabric = (f) => {
    selectFabric(f.key);
    // Auto-switch supplier based on fabric's supplier
    const catEntry = catalogFabrics.find(cf => cf.code === f.key);
    if (catEntry?.supplier) {
      const sup = catEntry.supplier.toLowerCase();
      if (sup !== colorSupplier) setColorSupplier(sup);
    }
  };

  const colors = colorSupplier === 'medastex' ? MEDASTEX_COLORS : COTTONPROM_COLORS;

  return (
    <div className="fabric-section">
      <div className="section-label">Ткань</div>
      <div className="fit-selector">
        {fabrics.map(f => (
          <div
            key={f.key}
            className={`fit-option${fabric === f.key ? ' selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={fabric === f.key}
            onClick={() => handleSelectFabric(f)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectFabric(f); } }}
          >
            <div className="fit-check">{fabric === f.key ? '✓' : ''}</div>
            <div className="fit-info">
              <div className="fit-name">{f.name}</div>
              <div className="fit-desc">{f.meta} · {f.sub}</div>
            </div>
          </div>
        ))}
      </div>
      {fabric && <div className="fabric-color-count">Доступные цвета: {colors.length}</div>}
    </div>
  );
}

// ── Color Picker ──
function ColorPicker() {
  const { type, color, selectColor, colorSupplier, setColorSupplier } = useStore(
    useShallow(s => ({ type: s.type, color: s.color, selectColor: s.selectColor,
      colorSupplier: s.colorSupplier, setColorSupplier: s.setColorSupplier }))
  );
  const [colorSearch, setColorSearch] = useState('');
  if (isAccessory(type)) return null;

  const colors = colorSupplier === 'medastex' ? MEDASTEX_COLORS : COTTONPROM_COLORS;
  const groups = colorSupplier === 'medastex' ? COLOR_GROUPS : COTTONPROM_GROUPS;

  const searchLower = colorSearch.toLowerCase();

  return (
    <div className="color-section">
      <div className="section-label">Цвет базы</div>
      <div className="supplier-tabs">
        <button className={`supplier-tab${colorSupplier === 'medastex' ? ' active' : ''}`} onClick={() => setColorSupplier('medastex')}>
          Medastex <span className="supplier-tab-count">{MEDASTEX_COLORS.length}</span>
        </button>
        <button className={`supplier-tab${colorSupplier === 'cottonprom' ? ' active' : ''}`} onClick={() => setColorSupplier('cottonprom')}>
          CottonProm <span className="supplier-tab-count">{COTTONPROM_COLORS.length}</span>
        </button>
      </div>
      <div className="color-search-wrap">
        <input
          type="text"
          className="color-search-input"
          placeholder="Поиск цвета..."
          value={colorSearch}
          onChange={e => setColorSearch(e.target.value)}
        />
        {color && <div className="color-selected-info">Выбран: {colors.find(c => c.code === color)?.name || color}</div>}
      </div>
      <div className="swatches">
        {groups.map(g => {
          const groupColors = g.codes.map(code => colors.find(c => c.code === code)).filter(Boolean);
          if (!groupColors.length) return null;
          return [
            !searchLower && <div key={'gl-' + g.label} className="swatch-group-label">{g.label}</div>,
            ...groupColors.map(entry => {
              const hidden = searchLower && !entry.name.toLowerCase().includes(searchLower) && !entry.code.toLowerCase().includes(searchLower);
              return (
                <div
                  key={entry.code}
                  className={`swatch${color === entry.code ? ' selected' : ''}${hidden ? ' hidden' : ''}`}
                  title={`${entry.name} (${entry.code})`}
                  role="button"
                  tabIndex={hidden ? -1 : 0}
                  aria-pressed={color === entry.code}
                  aria-label={`${entry.name} (${entry.code})`}
                  onClick={() => selectColor(entry.code)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectColor(entry.code); } }}
                >
                  <div className="swatch-circle" style={{ backgroundColor: entry.hex }} />
                  <div className="swatch-code">{entry.code}</div>
                  <div className="swatch-label">{entry.name}</div>
                </div>
              );
            })
          ];
        })}
      </div>
    </div>
  );
}

// ── Size ordering & sorting ──
function buildSortedRows(stdSizes, sizes, customSizes) {
  const stdRows = stdSizes.map(s => ({ type: 'std', label: s, qty: sizes[s] || 0 }));
  const customRows = (customSizes || []).map((cs, i) => ({ type: 'custom', label: cs.label, qty: cs.qty || 0, idx: i }));
  const all = [...stdRows, ...customRows];
  all.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
  return all;
}

// ── Size Table ──
function SizeTable() {
  const { type, sku, sizes, setSize, setOneSizeQty, customSizes, addCustomSize, removeCustomSize, setCustomSizeQty, setCustomSizeLabel } = useStore(
    useShallow(s => ({ type: s.type, sku: s.sku, sizes: s.sizes, setSize: s.setSize, setOneSizeQty: s.setOneSizeQty,
      customSizes: s.customSizes, addCustomSize: s.addCustomSize, removeCustomSize: s.removeCustomSize,
      setCustomSizeQty: s.setCustomSizeQty, setCustomSizeLabel: s.setCustomSizeLabel }))
  );
  const price = useStore(s => getUnitPrice(s));
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newQty, setNewQty] = useState(0);
  const sizeRefs = useRef({});
  const isAcc = isAccessory(type);

  // Available sizes: use sku.availableSizes if present, otherwise all sizes
  const availableSizes = sku?.availableSizes || null;
  const isSizeAvailable = (s) => !availableSizes || availableSizes.includes(s);

  // Tab navigation: focus next size input
  const handleSizeKeyDown = (e, currentLabel, allLabels) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      const idx = allLabels.indexOf(currentLabel);
      if (idx >= 0 && idx < allLabels.length - 1) {
        e.preventDefault();
        const nextLabel = allLabels[idx + 1];
        sizeRefs.current[nextLabel]?.focus();
      }
    }
  };

  if (isAcc) {
    const qty = sizes['ONE SIZE'] || 1;
    return (
      <div className="size-section">
        <div className="section-label">Тираж</div>
        <div className="one-size-row">
          <button className="qty-btn" onClick={() => setOneSizeQty(qty - 1)}>−</button>
          <input type="number" className="qty-input" value={qty} min={1} max={99999} onChange={e => setOneSizeQty(Math.min(99999, parseInt(e.target.value) || 1))} />
          <button className="qty-btn" onClick={() => setOneSizeQty(qty + 1)}>+</button>
          <span className="qty-label">шт</span>
        </div>
      </div>
    );
  }

  const stdQty = Object.values(sizes).reduce((s, v) => s + (parseInt(v) || 0), 0);
  const customQty = (customSizes || []).reduce((s, c) => s + (parseInt(c.qty) || 0), 0);
  const totalQty = stdQty + customQty;
  const totalSum = totalQty * price;

  const allRows = buildSortedRows(SIZES, sizes, customSizes);

  const allInputLabels = allRows.filter(r => r.type === 'std' ? isSizeAvailable(r.label) : true).map(r => r.type === 'std' ? r.label : 'cs-' + r.idx);

  const handleAddSize = () => {
    const raw = newLabel.trim().toUpperCase();
    if (!raw) return;
    // Normalize: "xxxl" → "3XL", etc.
    const xMatch = raw.match(/^(X+)L$/);
    const normalized = xMatch && xMatch[1].length >= 2
      ? `${xMatch[1].length}XL`
      : raw;
    // Check for duplicates
    const allExisting = [...SIZES.map(s => s.toUpperCase()), ...(customSizes || []).map(c => c.label.toUpperCase())];
    if (allExisting.includes(normalized)) {
      setNewLabel('');
      return;
    }
    addCustomSize(normalized);
    if (newQty > 0) {
      // Find the new index after sorting
      setTimeout(() => {
        const cs = useStore.getState().customSizes;
        const idx = cs.findIndex(c => c.label === normalized);
        if (idx >= 0) setCustomSizeQty(idx, newQty);
      }, 0);
    }
    setNewLabel('');
    setNewQty(0);
    setShowAddForm(false);
  };

  return (
    <div className="size-section">
      <div className="section-label">Размеры</div>

      {/* Desktop table */}
      <table className="size-table size-table-desktop">
        <thead>
          <tr>
            <th>Размер</th>
            <th>Количество</th>
            <th className="size-th-price">Цена/шт</th>
            <th className="size-th-sum">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {allRows.map((row, idx) => {
            const q = parseInt(row.qty) || 0;
            const rowSum = q * price;
            const available = row.type === 'std' ? isSizeAvailable(row.label) : true;
            const inputKey = row.type === 'std' ? row.label : 'cs-' + row.idx;
            return row.type === 'std' ? (
              <tr key={row.label} className={!available ? 'size-row-disabled' : ''} title={!available ? `${row.label} недоступен для этого артикула` : undefined}>
                <td><b>{row.label}</b></td>
                <td>
                  <div className="qty-control">
                    <button className="qty-btn" disabled={!available} onClick={() => setSize(row.label, Math.max(0, (parseInt(sizes[row.label]) || 0) - 1))}>−</button>
                    <input
                      ref={el => { sizeRefs.current[inputKey] = el; }}
                      type="number"
                      className="qty-input"
                      min={0}
                      max={99999}
                      value={sizes[row.label] || ''}
                      placeholder="0"
                      disabled={!available}
                      tabIndex={available ? idx + 1 : -1}
                      onChange={e => setSize(row.label, e.target.value)}
                      onKeyDown={e => handleSizeKeyDown(e, inputKey, allInputLabels)}
                    />
                    <button className="qty-btn" disabled={!available} onClick={() => setSize(row.label, (parseInt(sizes[row.label]) || 0) + 1)}>+</button>
                  </div>
                </td>
                <td className="size-td-price">{price.toLocaleString('ru-RU')} ₽</td>
                <td className="size-td-sum">{q > 0 ? (rowSum.toLocaleString('ru-RU') + ' ₽') : '—'}</td>
              </tr>
            ) : (
              <tr key={'cs-' + row.idx} className="custom-size-row">
                <td>
                  <input
                    type="text"
                    className="custom-size-label-input"
                    value={row.label}
                    onChange={e => setCustomSizeLabel(row.idx, e.target.value)}
                  />
                </td>
                <td>
                  <div className="qty-control">
                    <button className="qty-btn" onClick={() => setCustomSizeQty(row.idx, Math.max(0, (parseInt(row.qty) || 0) - 1))}>−</button>
                    <input
                      ref={el => { sizeRefs.current[inputKey] = el; }}
                      type="number"
                      className="qty-input"
                      min={0}
                      value={row.qty || ''}
                      placeholder="0"
                      tabIndex={idx + 1}
                      onChange={e => setCustomSizeQty(row.idx, e.target.value)}
                      onKeyDown={e => handleSizeKeyDown(e, inputKey, allInputLabels)}
                    />
                    <button className="qty-btn" onClick={() => setCustomSizeQty(row.idx, (parseInt(row.qty) || 0) + 1)}>+</button>
                  </div>
                </td>
                <td className="size-td-price">{price.toLocaleString('ru-RU')} ₽</td>
                <td className="size-td-sum">
                  <span>{q > 0 ? (rowSum.toLocaleString('ru-RU') + ' ₽') : '—'}</span>
                  <button className="size-rm-btn" onClick={() => removeCustomSize(row.idx)} aria-label="Удалить размер">✕</button>
                </td>
              </tr>
            );
          })}
          <tr className="size-total-row">
            <td className="size-total-label">ИТОГО</td>
            <td className="size-total-qty">{totalQty} шт</td>
            <td></td>
            <td className="size-total-sum">{totalSum > 0 ? (totalSum.toLocaleString('ru-RU') + ' ₽') : '0 ₽'}</td>
          </tr>
        </tbody>
      </table>

      {/* Mobile vertical list */}
      <div className="size-list-mobile">
        {allRows.map((row) => {
          const available = row.type === 'std' ? isSizeAvailable(row.label) : true;
          const inputKey = row.type === 'std' ? row.label : 'cs-' + row.idx;
          return (
            <div key={inputKey} className={`size-mobile-row${!available ? ' disabled' : ''}`} title={!available ? `${row.label} недоступен для этого артикула` : undefined}>
              <span className="size-mobile-label">{row.label}</span>
              <div className="qty-control">
                <button className="qty-btn" disabled={!available} onClick={() => row.type === 'std' ? setSize(row.label, Math.max(0, (parseInt(sizes[row.label]) || 0) - 1)) : setCustomSizeQty(row.idx, Math.max(0, (parseInt(row.qty) || 0) - 1))}>−</button>
                <input
                  type="number"
                  className="qty-input qty-input-mobile"
                  min={0}
                  value={row.type === 'std' ? (sizes[row.label] || '') : (row.qty || '')}
                  placeholder="0"
                  disabled={!available}
                  inputMode="numeric"
                  onChange={e => row.type === 'std' ? setSize(row.label, e.target.value) : setCustomSizeQty(row.idx, e.target.value)}
                />
                <button className="qty-btn" disabled={!available} onClick={() => row.type === 'std' ? setSize(row.label, (parseInt(sizes[row.label]) || 0) + 1) : setCustomSizeQty(row.idx, (parseInt(row.qty) || 0) + 1)}>+</button>
              </div>
              <span className="size-mobile-unit">шт</span>
              {row.type === 'custom' && <button className="size-rm-btn" onClick={() => removeCustomSize(row.idx)} aria-label="Удалить размер">✕</button>}
            </div>
          );
        })}
        <div className="size-mobile-total">Итого: {totalQty} шт · {totalSum > 0 ? (totalSum.toLocaleString('ru-RU') + ' ₽') : '0 ₽'}</div>
      </div>

      {/* Add custom size */}
      {showAddForm ? (
        <div className="add-size-form">
          <span className="add-size-form-label">РАЗМЕР</span>
          <input
            type="text"
            className="add-size-form-input"
            placeholder="4XL, 5XL..."
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddSize()}
            autoFocus
          />
          <span className="add-size-form-label">КОЛ-ВО</span>
          <input
            type="number"
            className="add-size-form-qty"
            min={0}
            value={newQty || ''}
            placeholder="0"
            onChange={e => setNewQty(parseInt(e.target.value) || 0)}
            onKeyDown={e => e.key === 'Enter' && handleAddSize()}
          />
          <button className="btn-add-size" onClick={handleAddSize}>ДОБАВИТЬ</button>
          <button className="btn-cancel-size" onClick={() => { setShowAddForm(false); setNewLabel(''); setNewQty(0); }}>ОТМЕНА</button>
        </div>
      ) : (
        <button className="add-size-btn" onClick={() => setShowAddForm(true)}>+ ДОБАВИТЬ РАЗМЕР</button>
      )}
    </div>
  );
}

// ── Mockup Preview ──
function MockupPreview() {
  const { type, color } = useStore(
    useShallow(s => ({ type: s.type, color: s.color }))
  );
  if (!type) return null;
  const svg = getGarmentSVG(type, color);
  return (
    <div className="mockup-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

// ── Main Step ──
function PriceBadge({ price }) {
  if (price === 0) return <span className="extra-price extra-price-free">бесплатно</span>;
  return <span className="extra-price">+{price} ₽</span>;
}

export default function StepGarment() {
  const { nextStep, type, color, fabric, sku, extras, extrasCatalog, toggleExtra } = useStore(
    useShallow(s => ({ nextStep: s.nextStep, type: s.type, color: s.color, fabric: s.fabric, sku: s.sku,
      extras: s.extras, extrasCatalog: s.extrasCatalog, toggleExtra: s.toggleExtra }))
  );
  const totalQty = useStore(s => getTotalQty(s));
  const [showExtras, setShowExtras] = useState(false);
  const isAcc = isAccessory(type);
  const canNext = sku && type && totalQty > 0 && (isAcc || color);
  const showFabric = !!sku && !isAcc;
  const showColor = !!sku && !isAcc && !!fabric;
  const showSizes = !!sku && (isAcc || !!color);

  const [validationMsg, setValidationMsg] = useState('');

  const handleNext = () => {
    if (canNext) {
      setValidationMsg('');
      nextStep();
      return;
    }
    // Build validation message
    const missing = [];
    if (!sku) missing.push('артикул');
    if (!isAcc && !fabric) missing.push('ткань');
    if (!isAcc && !color) missing.push('цвет');
    if (totalQty <= 0) missing.push('количество (размеры)');
    setValidationMsg('Заполните: ' + missing.join(', '));
  };

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 01 — Изделие</div>
        <h1 className="step-header-title">ИЗДЕЛИЕ</h1>
        <p className="step-header-desc">Выберите изделие, ткань и цвет</p>
      </div>
      <SkuList />
      {showFabric && <FabricGrid />}
      {showColor && <ColorPicker />}
      {showSizes && <SizeTable />}
      {/* Extras accordion */}
      {sku && (() => {
        const totalExtrasCost = calcExtrasCost(extras, extrasCatalog);
        const availableExtras = extrasCatalog.filter(e => !e.forCategories?.length || e.forCategories.includes(sku.category));
        return (
          <div className="extras-accordion" style={{ marginTop: 16 }}>
            <button
              className="extras-accordion-toggle"
              onClick={() => setShowExtras(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-card, #f5f5f5)', border: '1px solid var(--border, #e0e0e0)', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
            >
              {showExtras ? '\u25B2' : '\u25BC'} Доп. обработки
              {extras.length > 0 && <span className="section-badge">+{totalExtrasCost} ₽/шт ({extras.length})</span>}
            </button>
            {showExtras && availableExtras.length > 0 && (
              <div className="extras-list" style={{ marginTop: 8 }}>
                {EXTRAS_GROUPS
                  .map(g => ({ ...g, items: availableExtras.filter(e => e.group === g.id) }))
                  .filter(g => g.items.length > 0)
                  .map(group => (
                    <div key={group.id} className="extras-group">
                      <div className="extras-group-label">{group.name}</div>
                      {group.items.map(e => {
                        const sel = extras.includes(e.code);
                        const desc = EXTRAS_DESCS[e.code];
                        return (
                          <div
                            key={e.code}
                            className={`extras-list-item${sel ? ' selected' : ''}`}
                            role="checkbox"
                            tabIndex={0}
                            aria-checked={sel}
                            aria-label={e.name}
                            onClick={() => toggleExtra(e.code)}
                            onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleExtra(e.code); } }}
                            title={desc || e.name}
                          >
                            <div className="extra-check">{sel && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>
                            <div className="extras-list-name">{e.name}</div>
                            <PriceBadge price={e.price} />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                {availableExtras.filter(e => !e.group).map(e => {
                  const sel = extras.includes(e.code);
                  return (
                    <div
                      key={e.code}
                      className={`extras-list-item${sel ? ' selected' : ''}`}
                      role="checkbox"
                      tabIndex={0}
                      aria-checked={sel}
                      aria-label={e.name}
                      onClick={() => toggleExtra(e.code)}
                      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleExtra(e.code); } }}
                      title={EXTRAS_DESCS[e.code] || e.name}
                    >
                      <div className="extra-check">{sel && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>
                      <div className="extras-list-name">{e.name}</div>
                      <PriceBadge price={e.price} />
                    </div>
                  );
                })}
              </div>
            )}
            {showExtras && availableExtras.length === 0 && (
              <div className="empty-state">Для «{sku.name}» нет доступных обработок</div>
            )}
          </div>
        );
      })()}

      {validationMsg && (
        <div className="validation-warning" style={{ color: '#b71c1c', background: '#fce4ec', border: '1px solid #ef9a9a', borderRadius: 6, padding: '8px 14px', marginTop: 12, fontSize: 13 }}>
          {validationMsg}
        </div>
      )}
      <div className="btn-row">
        <button
          className={`btn-next${canNext ? '' : ' disabled'}`}
          disabled={!sku}
          title={!sku ? 'Выберите артикул' : ''}
          onClick={handleNext}
        >
          Далее
        </button>
      </div>
    </div>
  );
}
