import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { MEDASTEX_COLORS, COTTONPROM_COLORS } from '../../../data';
import { FABRICS_CATALOG_DEFAULT, LAYER1_TYPES } from '../../../data';
import { useState } from 'react';
import { isAccessory } from '../../../utils/pricing';
import { materialPrice } from '../../../utils/costRules';
import { searchFabrics } from '../../../utils/materialSearch';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { colorSupplierOf } from '../../../utils/colorSupplier';

const SEARCH_FROM = 6;

export default function FabricGrid() {
  const { type, fabric, selectFabric, setColorSupplier, sku, fabricsCatalog, colorSupplier, usdRate, skuCatalog } = useStore(
    useShallow(s => ({ type: s.type, fabric: s.fabric, selectFabric: s.selectFabric, setColorSupplier: s.setColorSupplier,
      sku: s.sku, fabricsCatalog: s.fabricsCatalog, colorSupplier: s.colorSupplier, usdRate: s.usdRate, skuCatalog: s.skuCatalog }))
  );
  const [query, setQuery] = useState('');
  // Аксессуар без модели — ткани нет; шопперу по модели ткань выбирается (правка 13.10)
  if (isAccessory(type) && !sku?.category) return null;

  let fabrics;
  let catalogFabrics = [];
  if (sku?.category) {
    catalogFabrics = fabricsCatalog.filter(f => (f.forCategories || []).includes(sku.category));
    // Per-SKU fabric restriction
    if (sku.allowedFabrics?.length) {
      catalogFabrics = catalogFabrics.filter(f => sku.allowedFabrics.includes(f.code));
    }
    const total = catalogFabrics.length;
    // Поиск — по всему каталогу: модель, поставщик, ткань (правка 13.10, п. 10)
    if (query.trim()) catalogFabrics = searchFabrics(fabricsCatalog, query, SKU_CATEGORIES, skuCatalog)
      .filter(f => !sku.allowedFabrics?.length || sku.allowedFabrics.includes(f.code));
    if (catalogFabrics.length > 0 || total >= SEARCH_FROM) {
      fabrics = catalogFabrics.map(f => {
        const price = materialPrice(f, usdRate);
        return {
          key: f.code, name: f.name,
          meta: [f.composition, f.density ? f.density + ' г/м²' : null].filter(Boolean).join(' · '),
          sub: (price ? Math.round(price) + ' ₽/м · ' : 'нет цены · ') + f.supplier,
          supplier: f.supplier,
        };
      });
    }
  }
  if (!fabrics) {
    const layerCats = LAYER1_TYPES.includes(type)
      ? LAYER1_TYPES
      : ['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts','bombers'];
    const fallbackFabrics = FABRICS_CATALOG_DEFAULT.filter(f =>
      (f.forCategories || []).some(c => layerCats.includes(c)));
    fabrics = fallbackFabrics.map(f => ({ key: f.code, name: f.name, meta: f.composition + (f.density ? ' ' + f.density + ' г/м²' : ''), sub: f.supplier, priceKey: f.code }));
  }

  if (!fabrics.length && !query.trim()) return null;

  const handleSelectFabric = (f) => {
    selectFabric(f.key);
    const catEntry = catalogFabrics.find(cf => cf.code === f.key);
    if (catEntry?.supplier) {
      const sup = colorSupplierOf(catEntry.supplier);
      if (sup !== colorSupplier) setColorSupplier(sup);
    }
  };

  const colors = colorSupplier === 'medastex' ? MEDASTEX_COLORS : COTTONPROM_COLORS;

  return (
    <div className="fabric-section">
      <div className="section-label">Ткань</div>
      {(fabrics.length >= SEARCH_FROM || query) && (
        <input className="page-search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Поставщик, ткань, плотность: «тонитекс футер 380»" aria-label="Поиск ткани" />
      )}
      {query.trim() && fabrics.length === 0 && (
        <div className="fabric-not-found" role="alert">Ткань не найдена — уточните запрос. Без ткани цена не считается.</div>
      )}
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
