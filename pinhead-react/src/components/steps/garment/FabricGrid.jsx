import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { FABRICS_CATALOG_DEFAULT, LAYER1_TYPES } from '../../../data';
import { useState } from 'react';
import { isAccessory } from '../../../utils/pricing';
import { materialPrice } from '../../../utils/costRules';
import { searchFabrics } from '../../../utils/materialSearch';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { colorSupplierOf } from '../../../utils/colorSupplier';
import { offeredColors, supplierForFabric } from '../../../orderstudio/catalog/suppliers';
import { Icon } from '../../../erp/components/Icon';
import panel from './panel.module.css';
import styles from './FabricGrid.module.css';

const SEARCH_FROM = 6;

/** `readOnly` — ткани видны, выбор закрыт (`aria-disabled`) */
export default function FabricGrid({ readOnly = false }) {
  const { type, fabric, selectFabric, setColorSupplier, sku, fabricsCatalog, colorSupplier, usdRate, skuCatalog, suppliers } = useStore(
    useShallow(s => ({ type: s.type, fabric: s.fabric, selectFabric: s.selectFabric, setColorSupplier: s.setColorSupplier,
      sku: s.sku, fabricsCatalog: s.fabricsCatalog, colorSupplier: s.colorSupplier, usdRate: s.usdRate, skuCatalog: s.skuCatalog,
      suppliers: s.suppliers }))
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
    if (readOnly) return;
    selectFabric(f.key);
    const catEntry = catalogFabrics.find(cf => cf.code === f.key);
    // Палитра — по справочнику «Поставщики и палитры»: привязка или палитра по умолчанию
    if (catEntry) {
      const sup = colorSupplierOf(catEntry.supplier || '', suppliers);
      if (sup !== colorSupplier) setColorSupplier(sup);
    }
  };

  // Сколько цветов предложит ColorPicker: активные цвета палитры ткани
  const fabricEntry = fabricsCatalog.find(f => f.code === fabric);
  const colorCount = offeredColors(fabricEntry ? supplierForFabric(fabricEntry, suppliers) : null).length;

  return (
    <section className={panel.section} aria-labelledby="garment-fabric-title">
      <div className={panel.sectionLabel} id="garment-fabric-title">Ткань</div>
      {(fabrics.length >= SEARCH_FROM || query) && (
        <input className={`${panel.search} ${styles.search}`} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Поставщик, ткань, плотность: «тонитекс футер 380»" aria-label="Поиск ткани" />
      )}
      {query.trim() && fabrics.length === 0 && (
        <div className={styles.notFound} role="alert">Ткань не найдена — уточните запрос. Без ткани цена не считается.</div>
      )}
      <div className={styles.grid}>
        {fabrics.map(f => (
          <div
            key={f.key}
            className={`${styles.option}${fabric === f.key ? ` ${styles.selected}` : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={fabric === f.key}
            aria-disabled={readOnly || undefined}
            onClick={() => handleSelectFabric(f)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectFabric(f); } }}
          >
            <div className={styles.check}>{fabric === f.key && <Icon name="check" size={14} />}</div>
            <div className={styles.info}>
              <div className={styles.name}>{f.name}</div>
              <div className={styles.desc}>{f.meta} · {f.sub}</div>
            </div>
          </div>
        ))}
      </div>
      {fabric && fabricEntry && <div className={styles.colorCount}>Доступные цвета: {colorCount}</div>}
    </section>
  );
}
