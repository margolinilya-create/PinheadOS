import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { getAvailableZonesForSku } from '../../../utils/skuRules';
import { Modal } from '../../../erp/components/Modal';
import { Button } from '../../../erp/components/Button';
import PhotosSection from './skuDetail/PhotosSection';
import SizeChartSection from './skuDetail/SizeChartSection';
import PricingSection from './skuDetail/PricingSection';
import ColorsSection from './skuDetail/ColorsSection';
import FabricsSection from './skuDetail/FabricsSection';
import ZoneChecks from './ZoneChecks';
import m from './SkuModal.module.css';

const FITS = [['', '—'], ['classic', 'Classic'], ['regular', 'Regular'], ['free', 'Free'], ['oversize', 'Oversize']];

/**
 * Карточка модели каталога (`/sku` → фото в строке): фото, описания, табель мер,
 * зоны, себестоимость, правила модели, параметры. Правка применяется к каталогу
 * на экране сразу; в базу — «Сохранить каталог» (фото сохраняют каталог сами).
 *
 * Разрезана в вехе 8 (задача 3): было 629 строк одним файлом, секции —
 * в `skuDetail/`. Оболочка окна — примитив ERP `Modal`.
 */
export default function SkuDetailModal({ sku, skuIndex, onUpdate, onClose, onPersist }) {
  const { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, categoryRules, zonesCatalog } = useStore(
    useShallow((s) => ({
      fabricsCatalog: s.fabricsCatalog, trimCatalog: s.trimCatalog, extrasCatalog: s.extrasCatalog,
      usdRate: s.usdRate, categoryRules: s.categoryRules, zonesCatalog: s.zonesCatalog,
    })),
  );
  const set = (field) => (e) => onUpdate(skuIndex, field, e.target.value);
  const setNum = (field) => (e) => onUpdate(skuIndex, field, Number(e.target.value) || 0);
  const overrides = sku.overrides || {};
  const clearColors = () => {
    const next = { ...overrides };
    delete next.allowedColors;
    onUpdate(skuIndex, 'overrides', Object.keys(next).length > 0 ? next : undefined);
  };
  const toggleZone = (id) => {
    const zones = sku.zones || [];
    onUpdate(skuIndex, 'zones', zones.includes(id) ? zones.filter((z) => z !== id) : [...zones, id]);
  };

  return (
    <Modal title={`Модель: ${sku.name}`} onClose={onClose} className={m.wide}>
      <p className={m.code}>Артикул {sku.code}</p>

      <PhotosSection sku={sku} skuIndex={skuIndex} onUpdate={onUpdate} onPersist={onPersist} />

      <section className={m.section} aria-labelledby="sku-detail-desc">
        <h3 id="sku-detail-desc" className={m.sectionHead}>Описание</h3>
        <div className={m.field}>
          <label htmlFor="sku-detail-short" className={m.label}>Коротко — строка в списке моделей</label>
          <input id="sku-detail-short" className={m.input} value={sku.shortDesc || ''} onChange={set('shortDesc')}
            placeholder="Например, плотная футболка свободного кроя" />
        </div>
        <div className={m.field}>
          <label htmlFor="sku-detail-full" className={m.label}>Полное описание</label>
          <textarea id="sku-detail-full" className={m.input} rows={4} value={sku.description || ''} onChange={set('description')}
            placeholder="Крой, материал, особенности, уход" />
        </div>
      </section>

      <SizeChartSection sku={sku} skuIndex={skuIndex} onUpdate={onUpdate} />

      <section className={m.section} aria-labelledby="sku-detail-zones">
        <h3 id="sku-detail-zones" className={m.sectionHead}>Зоны нанесения</h3>
        <ZoneChecks zones={getAvailableZonesForSku(zonesCatalog, sku.category)} selected={sku.zones || []}
          onToggle={toggleZone} label="Зоны нанесения модели" />
      </section>

      <PricingSection sku={sku} skuIndex={skuIndex} onUpdate={onUpdate} categoryRules={categoryRules}
        fabricsCatalog={fabricsCatalog} trimCatalog={trimCatalog} usdRate={usdRate}>
        <ColorsSection
          sku={sku}
          onChange={(colors) => onUpdate(skuIndex, 'overrides', { ...overrides, allowedColors: colors })}
          onClear={clearColors}
        />
        <FabricsSection sku={sku} skuIndex={skuIndex} onUpdate={onUpdate}
          fabricsCatalog={fabricsCatalog} extrasCatalog={extrasCatalog} />
      </PricingSection>

      <section className={m.section} aria-labelledby="sku-detail-params">
        <h3 id="sku-detail-params" className={m.sectionHead}>Параметры</h3>
        <div className={m.grid}>
          <div className={m.field}>
            <label htmlFor="sku-detail-name" className={m.label}>Название</label>
            <input id="sku-detail-name" className={m.input} value={sku.name} onChange={set('name')} />
          </div>
          <div className={m.field}>
            <label htmlFor="sku-detail-fit" className={m.label}>Fit</label>
            <select id="sku-detail-fit" className={m.input} value={sku.fit || ''}
              onChange={(e) => onUpdate(skuIndex, 'fit', e.target.value || null)}>
              {FITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className={m.field}>
            <label htmlFor="sku-detail-sewing" className={m.label}>Пошив, ₽</label>
            <input id="sku-detail-sewing" className={m.input} type="number" value={sku.sewingPrice} onChange={setNum('sewingPrice')} />
          </div>
          <div className={m.field}>
            <label htmlFor="sku-detail-usage" className={m.label}>Расход ткани, м</label>
            <input id="sku-detail-usage" className={m.input} type="number" step="0.1" value={sku.mainFabricUsage}
              onChange={setNum('mainFabricUsage')} />
          </div>
        </div>
      </section>

      <div className={m.actions}>
        <span className={m.hint}>Изменения применены — сохраните каталог</span>
        <Button onClick={onClose}>Закрыть</Button>
      </div>
    </Modal>
  );
}
