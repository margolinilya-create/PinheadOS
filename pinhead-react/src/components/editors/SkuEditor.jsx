import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { SKU_CATEGORIES } from '../../data/skuCatalog';
import { getSkuEstPrice } from '../../utils/pricing';
import { useSkuSave, failureText } from './sku/useSkuSave';
import SkuItemsTab from './sku/SkuItemsTab';
import SkuFabricsTab from './sku/SkuFabricsTab';
import SkuTrimsTab from './sku/SkuTrimsTab';
import ExtrasEditor from './sku/ExtrasEditor';
import SkuHardwareTab from './sku/SkuHardwareTab';
import PricingTabContent from './sku/PricingTabContent';
import CategoryRulesTab from './sku/CategoryRulesTab';
import ZonesCatalogTab from './sku/ZonesCatalogTab';
import AddSkuModal from './sku/AddSkuModal';
import ZonesModal from './sku/ZonesModal';
import RateBar from './sku/RateBar';
import { exportCatalogExcel, importCatalogExcel } from './sku/skuExcel';
import { searchFabrics } from '../../utils/materialSearch';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { PageHead } from '../../erp/components/PageHead';
import { Tabs, TabPanel } from '../../erp/components/Tabs';
import { Button } from '../../erp/components/Button';
import a11y from '../../orderstudio/ui/a11y.module.css';
import base from '../../orderstudio/screens/Sales.module.css';
import styles from './SkuEditor.module.css';

const TABS = [
  { id: 'items', name: 'Изделия' },
  { id: 'fabrics', name: 'Основная ткань' },
  { id: 'trims', name: 'Отделочная ткань' },
  { id: 'extras', name: 'Обработки' },
  { id: 'hardware', name: 'Фурнитура' },
  { id: 'pricing', name: 'Ценообразование' },
  { id: 'rules', name: 'Правила категорий' },
  { id: 'zones', name: 'Зоны нанесения' },
];

/** Телефон: каталог только для просмотра (как «Справочники заказа») */
const COMPACT = '(max-width: 760px)';

function generateCode(name) {
  const tr = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
    к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',
    ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  return (name || '').toLowerCase().split('').map(c => tr[c] || c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 20) || 'new';
}

function getDefaultZones(cat) {
  if (cat === 'accessories') return ['side-a', 'side-b'];
  if (['hoodies', 'ziphoodies'].includes(cat)) return ['front', 'back', 'sleeve-l', 'sleeve-r', 'hood'];
  return ['front', 'back', 'sleeve-l', 'sleeve-r'];
}

export default function SkuEditor() {
  const { skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, hardwareCatalog, categoryRules, zonesCatalog, usdRate } = useStore(
    useShallow(s => ({ skuCatalog: s.skuCatalog, fabricsCatalog: s.fabricsCatalog,
      trimCatalog: s.trimCatalog, extrasCatalog: s.extrasCatalog, hardwareCatalog: s.hardwareCatalog,
      categoryRules: s.categoryRules, zonesCatalog: s.zonesCatalog, usdRate: s.usdRate }))
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = TABS.some(t => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'items';
  const [tab, setTabState] = useState(initialTab);
  const setTab = (id) => {
    setTabState(id);
    setSearchParams(id === 'items' ? {} : { tab: id }, { replace: true });
  };
  // Телефон: каталог только для просмотра (К2 вехи 8), правка — с компьютера
  const readOnly = useMediaQuery(COMPACT);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showZonesModal, setShowZonesModal] = useState(null);
  const [addForm, setAddForm] = useState({ name: '', category: 'tshirts', fit: 'regular' });

  // extras and hardware now come from Zustand store (catalogSlice)

  const [fabricSupplierFilter, setFabricSupplierFilter] = useState('all');
  const [fabricSearch, setFabricSearch] = useState('');
  const [changedItems, setChangedItems] = useState(new Set());
  const [changedFabrics, setChangedFabrics] = useState(new Set());
  const [changedTrims, setChangedTrims] = useState(new Set());
  const [changedExtras, setChangedExtras] = useState(new Set());
  const [changedHardware, setChangedHardware] = useState(new Set());
  const [pricingDirty, setPricingDirty] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);

  // No useEffect to reload SKU — catalogSlice.loadCatalogs() already handles this at app startup.
  // Previously this useEffect was overwriting store with stale Supabase data (without photos).

  // Записанный (или заменённый свежей версией) справочник — флаги правок сняты
  const clearFlags = useCallback((fields) => {
    const empty = () => new Set();
    for (const f of fields) {
      if (f === 'skuCatalog') setChangedItems(empty);
      else if (f === 'fabricsCatalog') setChangedFabrics(empty);
      else if (f === 'trimCatalog') setChangedTrims(empty);
      else if (f === 'extrasCatalog') setChangedExtras(empty);
      else if (f === 'hardwareCatalog') setChangedHardware(empty);
      else if (f === 'categoryRules') setRulesDirty(false);
    }
  }, []);
  // Только изменённые справочники, с базой от открытия (веха 4: без затирания)
  const { edit: setField, saveAll, saving, failed, reloadConflicts, blocked } = useSkuSave(clearFlags);
  const hasConflict = failed.some((f) => f.kind === 'conflict');

  // ── SKU CRUD ──
  const updateSku = (idx, field, value) => {
    // Read latest state to avoid stale closure when called multiple times in sequence
    const current = useStore.getState().skuCatalog;
    const updated = current.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    setField('skuCatalog', updated);
    setChangedItems(prev => new Set(prev).add(idx));
  };
  const deleteSku = (idx) => {
    setField('skuCatalog', skuCatalog.filter((_, i) => i !== idx));
  };
  const addSku = () => {
    const isAccessory = addForm.category === 'accessories';
    const isHeavy = ['hoodies', 'sweatshirts', 'ziphoodies', 'pants'].includes(addForm.category);
    const code = generateCode(addForm.name) + '-' + String(skuCatalog.length + 1).padStart(3, '0');
    const newItem = {
      code,
      name: addForm.name || 'Новое изделие',
      category: addForm.category,
      fit: isAccessory ? null : addForm.fit,
      sewingPrice: isAccessory ? 150 : (isHeavy ? 350 : 200),
      mainFabricUsage: isAccessory ? 0.3 : (isHeavy ? 1.5 : 1.0),
      trimCode: isAccessory ? null : (isHeavy ? 'kashkorse' : 'ribana-1x1'),
      trimUsage: isAccessory ? 0 : 0.15,
      mockupType: 'tee',
      zones: getDefaultZones(addForm.category),
    };
    setField('skuCatalog', [...skuCatalog, newItem]);
    setShowAddModal(false);
    setAddForm({ name: '', category: 'tshirts', fit: 'regular' });
  };

  // ── Fabric CRUD ──
  const updateFabric = (idx, field, value) => {
    const updated = fabricsCatalog.map((f, i) => i === idx ? { ...f, [field]: value } : f);
    setField('fabricsCatalog', updated);
    setChangedFabrics(prev => new Set(prev).add(idx));
  };
  const addFabric = () => {
    setField('fabricsCatalog', [...fabricsCatalog, {
      code: generateCode('новая-ткань-' + (fabricsCatalog.length + 1)),
      name: 'Новая ткань', supplier: 'Медас', composition: '100% хб',
      density: null, priceRub: 0, unit: 'm', mPerKg: null, priceUSD: 0, forCategories: ['tshirts'],
    }]);
  };
  const deleteFabric = (idx) => {
    setField('fabricsCatalog', fabricsCatalog.filter((_, i) => i !== idx));
  };

  // ── Trim CRUD ──
  const updateTrim = (idx, field, value) => {
    const updated = trimCatalog.map((t, i) => i === idx ? { ...t, [field]: value } : t);
    setField('trimCatalog', updated);
    setChangedTrims(prev => new Set(prev).add(idx));
  };
  const addTrim = () => {
    setField('trimCatalog', [...trimCatalog, {
      code: generateCode('новая-отделка-' + (trimCatalog.length + 1)),
      name: 'Новая отделка', supplier: 'Медас', kind: null, priceRub: 0, unit: 'm', mPerKg: null, priceUSD: 0,
    }]);
  };
  const deleteTrim = (idx) => {
    setField('trimCatalog', trimCatalog.filter((_, i) => i !== idx));
  };

  // ── Extras CRUD ──
  const updateExtra = (idx, field, value) => {
    const current = useStore.getState().extrasCatalog;
    setField('extrasCatalog', current.map((e, i) => i === idx ? { ...e, [field]: value } : e));
    setChangedExtras(prev => new Set(prev).add(idx));
  };
  const addExtra = () => {
    const current = useStore.getState().extrasCatalog;
    setField('extrasCatalog', [...current, { code: generateCode('новая-обработка-' + (current.length + 1)), name: 'Новая обработка', price: 30 }]);
  };
  const deleteExtra = (idx) => {
    const current = useStore.getState().extrasCatalog;
    setField('extrasCatalog', current.filter((_, i) => i !== idx));
  };

  // ── Hardware CRUD ──
  const updateHardware = (idx, field, value) => {
    const current = useStore.getState().hardwareCatalog;
    setField('hardwareCatalog', current.map((h, i) => i === idx ? { ...h, [field]: value } : h));
    setChangedHardware(prev => new Set(prev).add(idx));
  };
  const addHardware = (group) => {
    const current = useStore.getState().hardwareCatalog;
    setField('hardwareCatalog', [...current, { code: generateCode('новая-фурн-' + (current.length + 1)), name: 'Новая фурнитура', price: 20, group }]);
  };
  const deleteHardware = (idx) => {
    const current = useStore.getState().hardwareCatalog;
    setField('hardwareCatalog', current.filter((_, i) => i !== idx));
  };

  const exportExcel = () => exportCatalogExcel({ skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, hardwareCatalog });
  const importExcel = () => importCatalogExcel(setField);

  // ── Computed ──
  const filteredSku = useMemo(() => {
    let items = skuCatalog;
    if (catFilter !== 'all') items = items.filter(s => s.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(s => (s.name || '').toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q));
    }
    return items;
  }, [skuCatalog, catFilter, search]);

  const groupedSku = useMemo(() => {
    const g = {};
    for (const s of filteredSku) {
      if (!g[s.category]) g[s.category] = [];
      g[s.category].push(s);
    }
    return g;
  }, [filteredSku]);

  const filteredFabrics = useMemo(() => {
    let items = fabricsCatalog;
    if (fabricSupplierFilter !== 'all') items = items.filter(f => f.supplier === fabricSupplierFilter);
    // По всему каталогу: модель + поставщик + ткань (правка 13.10, п. 10)
    return searchFabrics(items, fabricSearch, SKU_CATEGORIES, skuCatalog);
  }, [fabricsCatalog, fabricSupplierFilter, fabricSearch, skuCatalog]);

  // Себестоимость — та же функция, что в визарде и в «Заказах v4» (правка 13.10:
  // своя копия формулы здесь множила цену за кг на метры)
  const estimatePrice = (s) => Math.round(getSkuEstPrice(s, null, fabricsCatalog, trimCatalog, usdRate));

  const dirtyOf = (id) => {
    if (id === 'pricing') return pricingDirty;
    if (id === 'rules') return rulesDirty;
    const map = { items: changedItems, fabrics: changedFabrics, trims: changedTrims, extras: changedExtras, hardware: changedHardware };
    return map[id]?.size > 0;
  };
  // Признак несохранённых правок — часть имени вкладки: точка глазу, текст читалке.
  // Имя для читалки — одной строкой: точка (inline-block) между узлами дала бы
  // в имени «Изделия , есть…» с пробелом перед запятой
  const tabs = TABS.map((t) => ({
    id: t.id,
    label: dirtyOf(t.id) ? (
      <>
        <span aria-hidden="true">{t.name}<span className={styles.dirtyDot} /></span>
        <span className={a11y.srOnly}>{t.name}, есть несохранённые правки</span>
      </>
    ) : t.name,
  }));

  return (
    <div className={`${base.page} ${styles.page}`}>
      <div className={styles.head}>
        <PageHead title="Каталог моделей и цен" sub="Модели, ткани, обработки и цены для заказа" />
        <div className={styles.actions}>
          <Button icon="download" onClick={exportExcel}>Выгрузить в Excel</Button>
          {!readOnly && (
            <>
              <Button icon="arrowUpToLine" onClick={importExcel}>Загрузить из Excel</Button>
              <Button variant="primary" onClick={saveAll} loading={saving} disabled={blocked}>
                {saving ? 'Сохраняю…' : 'Сохранить каталог'}
              </Button>
            </>
          )}
        </div>
      </div>

      {readOnly && (
        <p className={styles.readOnlyNote} role="note">
          На телефоне каталог только для просмотра. Править — с компьютера.
        </p>
      )}

      {blocked && (
        <div className={styles.notice} role="status">
          <p>Каталог не загрузился из базы — сохранение недоступно, чтобы не записать локальную копию поверх базы. Обновите страницу.</p>
        </div>
      )}

      {failed.length > 0 && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          <p>Не сохранено: {failureText(failed)}. Правки на экране остались.</p>
          {hasConflict && (
            <>
              <p>Свежая версия заменит ваши правки в изменённых справочниках — внесите их снова поверх неё.</p>
              <Button onClick={reloadConflicts}>Загрузить свежую версию</Button>
            </>
          )}
        </div>
      )}

      <RateBar usdRate={usdRate} readOnly={readOnly} onRateChange={(v) => setField('usdRate', v)} />

      <div className={styles.tabs}>
        <Tabs idPrefix="sku" label="Разделы каталога" tabs={tabs} active={tab} onSelect={setTab} />
      </div>

      <TabPanel idPrefix="sku" active={tab} className={styles.panel}>
        {tab === 'items' && (
          <SkuItemsTab
            search={search} setSearch={setSearch} catFilter={catFilter} setCatFilter={setCatFilter}
            filteredSku={filteredSku} groupedSku={groupedSku} skuCatalog={skuCatalog} trimCatalog={trimCatalog}
            updateSku={updateSku} deleteSku={deleteSku} estimatePrice={estimatePrice}
            setShowAddModal={setShowAddModal} setShowZonesModal={setShowZonesModal}
            onPersist={saveAll} readOnly={readOnly}
          />
        )}

        {tab === 'fabrics' && (
          <SkuFabricsTab
            fabricSupplierFilter={fabricSupplierFilter} setFabricSupplierFilter={setFabricSupplierFilter}
            fabricSearch={fabricSearch} setFabricSearch={setFabricSearch}
            filteredFabrics={filteredFabrics} fabricsCatalog={fabricsCatalog}
            changedFabrics={changedFabrics} readOnly={readOnly}
            updateFabric={updateFabric} addFabric={addFabric} deleteFabric={deleteFabric}
          />
        )}

        {tab === 'trims' && (
          <SkuTrimsTab
            trimCatalog={trimCatalog} changedTrims={changedTrims} readOnly={readOnly}
            updateTrim={updateTrim} addTrim={addTrim} deleteTrim={deleteTrim}
          />
        )}

        {tab === 'extras' && (
          <ExtrasEditor
            extras={extrasCatalog}
            readOnly={readOnly}
            onUpdate={updateExtra}
            onAdd={addExtra}
            onDelete={deleteExtra}
            onToggleCat={(idx, catId) => {
              const e = extrasCatalog[idx];
              const cats = e.forCategories || [];
              const updated = cats.includes(catId) ? cats.filter(c => c !== catId) : [...cats, catId];
              updateExtra(idx, 'forCategories', updated);
            }}
          />
        )}

        {tab === 'hardware' && (
          <SkuHardwareTab
            hardwareCatalog={hardwareCatalog} readOnly={readOnly}
            updateHardware={updateHardware} addHardware={addHardware} deleteHardware={deleteHardware}
          />
        )}

        {tab === 'pricing' && (
          <PricingTabContent onDirtyChange={setPricingDirty} readOnly={readOnly} />
        )}

        {tab === 'rules' && (
          <CategoryRulesTab
            categoryRules={categoryRules}
            extrasCatalog={extrasCatalog}
            zonesCatalog={zonesCatalog}
            readOnly={readOnly}
            onUpdate={(rules) => { setField('categoryRules', rules); setRulesDirty(true); }}
          />
        )}

        {tab === 'zones' && (
          // Только просмотр: справочник зон правится во «Флэтах и зонах» (веха 5б)
          <ZonesCatalogTab zonesCatalog={zonesCatalog} />
        )}
      </TabPanel>

      {showAddModal && (
        <AddSkuModal
          addForm={addForm} setAddForm={setAddForm}
          onAdd={addSku} onClose={() => setShowAddModal(false)}
        />
      )}

      {showZonesModal !== null && (
        <ZonesModal
          skuItem={skuCatalog[showZonesModal]} skuIndex={showZonesModal}
          updateSku={updateSku} onClose={() => setShowZonesModal(null)}
        />
      )}
    </div>
  );
}
