import { useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { SKU_CATEGORIES } from '../../data';
import { MEDASTEX_COLORS, COLOR_GROUPS, COTTONPROM_COLORS, COTTONPROM_GROUPS, SIZES } from '../../data';
import { FABRICS_CATALOG_DEFAULT, LAYER1_TYPES, FABRICS_LAYER1, FABRICS_LAYER2 } from '../../data';
import { getSkuEstPrice, isAccessory, getTotalQty } from '../../utils/pricing';
import { getGarmentSVG } from '../../utils/mockup';

// ── SKU List ──
function SkuList() {
  const { skuCatalog, skuFilter, setSkuFilter, selectSku, reorderSku, sku, fabricsCatalog, trimCatalog, usdRate } = useStore();
  const dragRef = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const usedCats = [...new Set(skuCatalog.map(s => s.category))];
  const cats = SKU_CATEGORIES.filter(c => usedCats.includes(c.id));
  const filtered = skuFilter === 'all' ? skuCatalog : skuCatalog.filter(s => s.category === skuFilter);

  const groups = {};
  filtered.forEach(s => { if (!groups[s.category]) groups[s.category] = []; groups[s.category].push(s); });
  const catOrder = SKU_CATEGORIES.map(c => c.id);

  const onDragStart = (e, code) => { dragRef.current = code; e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnd = () => { dragRef.current = null; setDragOver(null); };
  const onDragOverRow = (e, code) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(code); };
  const onDropRow = (e, code) => { e.preventDefault(); setDragOver(null); if (dragRef.current && dragRef.current !== code) reorderSku(dragRef.current, code); };

  return (
    <div className="sku-section">
      <div className="section-label">Изделие</div>
      <div className="sku-cat-filter">
        <button className={`sku-cat-pill${skuFilter === 'all' ? ' active' : ''}`} onClick={() => setSkuFilter('all')}>Все</button>
        {cats.map(c => (
          <button key={c.id} className={`sku-cat-pill${skuFilter === c.id ? ' active' : ''}`} onClick={() => setSkuFilter(c.id)}>{c.name}</button>
        ))}
      </div>
      <div className="garment-list">
        {Object.keys(groups).sort((a, b) => catOrder.indexOf(a) - catOrder.indexOf(b)).map(catId => {
          const cat = SKU_CATEGORIES.find(c => c.id === catId);
          return (
            <div key={catId}>
              <div className="garment-sep"><span className="garment-sep-text">{cat?.name || catId}</span><div className="garment-sep-line" /></div>
              {groups[catId].map(s => {
                const est = getSkuEstPrice(s, fabricsCatalog, trimCatalog, usdRate);
                const isSelected = sku?.code === s.code;
                const fitLabel = s.fit || null;
                return (
                  <div
                    key={s.code}
                    className={`garment-row${isSelected ? ' selected' : ''}${dragOver === s.code ? ' drag-target' : ''}`}
                    draggable
                    onDragStart={e => onDragStart(e, s.code)}
                    onDragEnd={onDragEnd}
                    onDragOver={e => onDragOverRow(e, s.code)}
                    onDrop={e => onDropRow(e, s.code)}
                    onClick={() => selectSku(s)}
                  >
                    <div className="garment-row-bar" />
                    <span className="garment-row-name">{s.name}{fitLabel ? <span className="garment-row-fit">{fitLabel}</span> : null}</span>
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
  const { type, fabric, selectFabric, sku, fabricsCatalog, usdRate } = useStore();
  if (isAccessory(type)) return null;

  let fabrics;
  if (sku?.category) {
    const catFabrics = fabricsCatalog.filter(f => (f.forCategories || []).includes(sku.category));
    if (catFabrics.length > 0) {
      fabrics = catFabrics.map(f => ({ key: f.code, name: f.name, meta: Math.round(f.priceUSD * usdRate) + ' ₽/м', sub: '$' + f.priceUSD + '/м' }));
    }
  }
  if (!fabrics) {
    fabrics = LAYER1_TYPES.includes(type) ? FABRICS_LAYER1 : FABRICS_LAYER2;
  }

  if (!fabrics.length) return null;

  return (
    <div className="fabric-section">
      <div className="section-label">Ткань</div>
      <div className="fit-selector">
        {fabrics.map(f => (
          <div key={f.key} className={`fit-option${fabric === f.key ? ' selected' : ''}`} onClick={() => selectFabric(f.key)}>
            <div className="fit-check">{fabric === f.key ? '✓' : ''}</div>
            <div className="fit-info">
              <div className="fit-name">{f.name}</div>
              <div className="fit-desc">{f.meta} · {f.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Color Picker ──
function ColorPicker() {
  const { type, color, selectColor, colorSupplier, setColorSupplier } = useStore();
  const [colorSearch, setColorSearch] = useState('');
  if (isAccessory(type)) return null;

  const colors = colorSupplier === 'medastex' ? MEDASTEX_COLORS : COTTONPROM_COLORS;
  const groups = colorSupplier === 'medastex' ? COLOR_GROUPS : COTTONPROM_GROUPS;

  const searchLower = colorSearch.toLowerCase();

  return (
    <div className="color-section">
      <div className="section-label">Цвет базы</div>
      <div className="color-search-wrap">
        <input
          type="text"
          className="color-search-input"
          placeholder="Поиск цвета..."
          value={colorSearch}
          onChange={e => setColorSearch(e.target.value)}
        />
        <div className="supplier-switch">
          <button className={`supplier-btn${colorSupplier === 'medastex' ? ' active' : ''}`} onClick={() => setColorSupplier('medastex')}>Medastex</button>
          <button className={`supplier-btn${colorSupplier === 'cottonprom' ? ' active' : ''}`} onClick={() => setColorSupplier('cottonprom')}>CottonProm</button>
        </div>
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
                  onClick={() => selectColor(entry.code)}
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

// ── Size Table ──
function SizeTable() {
  const { type, sizes, setSize, setOneSizeQty, customSizes, addCustomSize, removeCustomSize, setCustomSizeQty, setCustomSizeLabel } = useStore();
  const isAcc = isAccessory(type);

  if (isAcc) {
    const qty = sizes['ONE SIZE'] || 1;
    return (
      <div className="size-section">
        <div className="section-label">Тираж</div>
        <div className="one-size-row">
          <button className="qty-btn" onClick={() => setOneSizeQty(qty - 1)}>−</button>
          <input type="number" className="qty-input" value={qty} min={1} onChange={e => setOneSizeQty(parseInt(e.target.value) || 1)} />
          <button className="qty-btn" onClick={() => setOneSizeQty(qty + 1)}>+</button>
          <span className="qty-label">шт</span>
        </div>
      </div>
    );
  }

  const stdQty = Object.values(sizes).reduce((s, v) => s + (parseInt(v) || 0), 0);
  const customQty = (customSizes || []).reduce((s, c) => s + (parseInt(c.qty) || 0), 0);
  const totalQty = stdQty + customQty;

  // Merge standard + custom sizes into one sorted list
  const allRows = [
    ...SIZES.map(s => ({ type: 'std', label: s, qty: sizes[s] || 0 })),
    ...(customSizes || []).map((cs, i) => ({ type: 'custom', label: cs.label, qty: cs.qty || 0, idx: i })),
  ];

  return (
    <div className="size-section">
      <div className="section-label">Размеры</div>
      <table className="size-table">
        <thead>
          <tr>
            <th>Размер</th>
            <th>Количество</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {allRows.map(row => row.type === 'std' ? (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>
                <div className="qty-control">
                  <button className="qty-btn" onClick={() => setSize(row.label, Math.max(0, (parseInt(sizes[row.label]) || 0) - 1))}>−</button>
                  <input
                    type="number"
                    className="qty-input"
                    min={0}
                    value={sizes[row.label] || ''}
                    placeholder="0"
                    onChange={e => setSize(row.label, e.target.value)}
                  />
                  <button className="qty-btn" onClick={() => setSize(row.label, (parseInt(sizes[row.label]) || 0) + 1)}>+</button>
                </div>
              </td>
              <td></td>
            </tr>
          ) : (
            <tr key={'cs-' + row.idx} className="custom-size-row">
              <td>
                <input
                  type="text"
                  className="qty-input"
                  style={{ width: 60, textAlign: 'left', fontSize: 12 }}
                  value={row.label}
                  onChange={e => setCustomSizeLabel(row.idx, e.target.value)}
                />
              </td>
              <td>
                <div className="qty-control">
                  <button className="qty-btn" onClick={() => setCustomSizeQty(row.idx, Math.max(0, (parseInt(row.qty) || 0) - 1))}>−</button>
                  <input
                    type="number"
                    className="qty-input"
                    min={0}
                    value={row.qty || ''}
                    placeholder="0"
                    onChange={e => setCustomSizeQty(row.idx, e.target.value)}
                  />
                  <button className="qty-btn" onClick={() => setCustomSizeQty(row.idx, (parseInt(row.qty) || 0) + 1)}>+</button>
                </div>
              </td>
              <td>
                <button className="qty-btn" style={{ color: '#c00', borderColor: '#c00' }} onClick={() => removeCustomSize(row.idx)}>✕</button>
              </td>
            </tr>
          ))}
          {totalQty > 0 && (
            <tr className="size-total-row">
              <td>Итого</td>
              <td>{totalQty} шт</td>
              <td></td>
            </tr>
          )}
        </tbody>
      </table>
      <button className="add-size-btn" onClick={() => addCustomSize()}>+ Добавить размер</button>
    </div>
  );
}

// ── Mockup Preview ──
function MockupPreview() {
  const { type, color } = useStore();
  if (!type) return null;
  const svg = getGarmentSVG(type, color);
  return (
    <div className="mockup-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

// ── Main Step ──
export default function StepGarment() {
  const { nextStep, type, color } = useStore();
  const state = useStore();
  const totalQty = getTotalQty(state);
  const canNext = type && totalQty > 0 && (isAccessory(type) || color);

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 01 — Изделие</div>
        <h1 className="step-header-title">ИЗДЕЛИЕ</h1>
        <p className="step-header-desc">Выберите изделие, ткань и цвет</p>
      </div>
      <SkuList />
      <hr className="divider" />
      <FabricGrid />
      <ColorPicker />
      <hr className="divider" />
      <SizeTable />
      <div className="btn-row">
        <button className={`btn-next${canNext ? '' : ' disabled'}`} onClick={() => canNext && nextStep()}>
          Далее
        </button>
      </div>
    </div>
  );
}
