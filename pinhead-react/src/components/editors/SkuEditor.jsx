import { useState, useMemo, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { SKU_CATEGORIES } from '../../data/skuCatalog';
// extras/hardware defaults now in catalogSlice
import { supabase } from '../../lib/supabase';
import { clearCatalogsCache } from '../../lib/catalogs';
import { toast } from '../../store/useToastStore';
import SkuItemsTab from './sku/SkuItemsTab';
import SkuFabricsTab from './sku/SkuFabricsTab';
import SkuTrimsTab from './sku/SkuTrimsTab';
import ExtrasEditor from './sku/ExtrasEditor';
import SkuHardwareTab from './sku/SkuHardwareTab';
import AddSkuModal from './sku/AddSkuModal';
import ZonesModal from './sku/ZonesModal';

const TABS = [
  { id: 'items', name: 'Изделия' },
  { id: 'fabrics', name: 'Основная ткань' },
  { id: 'trims', name: 'Отделочная ткань' },
  { id: 'extras', name: 'Обработки' },
  { id: 'hardware', name: 'Фурнитура' },
];

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
  const { skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, hardwareCatalog, usdRate, setField } = useStore(
    useShallow(s => ({ skuCatalog: s.skuCatalog, fabricsCatalog: s.fabricsCatalog,
      trimCatalog: s.trimCatalog, extrasCatalog: s.extrasCatalog, hardwareCatalog: s.hardwareCatalog,
      usdRate: s.usdRate, setField: s.setField }))
  );
  const [tab, setTab] = useState('items');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [cbRate, setCbRate] = useState(() => {
    try { const d = JSON.parse(localStorage.getItem('ph_cb_rate') || '{}'); return d.rate || null; } catch { return null; }
  });
  const [cbDate, setCbDate] = useState(() => {
    try { const d = JSON.parse(localStorage.getItem('ph_cb_rate') || '{}'); return d.date || ''; } catch { return ''; }
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showZonesModal, setShowZonesModal] = useState(null);
  const [addForm, setAddForm] = useState({ name: '', category: 'tshirts', fit: 'regular' });

  // extras and hardware now come from Zustand store (catalogSlice)

  const [saving, setSaving] = useState(false);
  const [fabricSupplierFilter, setFabricSupplierFilter] = useState('all');
  const [fabricSearch, setFabricSearch] = useState('');
  const [changedItems, setChangedItems] = useState(new Set());
  const [changedFabrics, setChangedFabrics] = useState(new Set());
  const [changedTrims, setChangedTrims] = useState(new Set());
  const [changedExtras, setChangedExtras] = useState(new Set());
  const [changedHardware, setChangedHardware] = useState(new Set());

  // No useEffect to reload SKU — catalogSlice.loadCatalogs() already handles this at app startup.
  // Previously this useEffect was overwriting store with stale Supabase data (without photos).

  const saveAll = useCallback(async () => {
    setSaving(true);
    // Clear session cache immediately so a refresh during save won't use stale data
    clearCatalogsCache();
    // Read latest state directly from store to avoid stale closures
    const state = useStore.getState();
    const currentSku = state.skuCatalog;
    if (import.meta.env.DEV) {
      const t001 = currentSku.find(s => s.code === 'T-001');
      console.log('[saveAll] T-001 photos:', t001?.photos);
    }
    const currentFabrics = state.fabricsCatalog;
    const currentTrims = state.trimCatalog;
    const currentExtras = state.extrasCatalog;
    const currentHardware = state.hardwareCatalog;
    try {
      localStorage.setItem('ph_sku', JSON.stringify(currentSku));
      localStorage.setItem('ph_fabrics', JSON.stringify(currentFabrics));
      localStorage.setItem('ph_trims', JSON.stringify(currentTrims));
      localStorage.setItem('ph_extras', JSON.stringify(currentExtras));
      localStorage.setItem('ph_hardware', JSON.stringify(currentHardware));
      localStorage.setItem('ph_usd_rate', String(state.usdRate));
    } catch { /* ignore storage errors */ }
    const ts = new Date().toISOString();
    const results = await Promise.all([
      supabase.from('app_config').upsert({ key: 'sku_catalog', value: currentSku, updated_at: ts }, { onConflict: 'key' }),
      supabase.from('catalog_config').upsert({ key: 'fabricsCatalog', value: currentFabrics, updated_at: ts }, { onConflict: 'key' }),
      supabase.from('catalog_config').upsert({ key: 'trimCatalog', value: currentTrims, updated_at: ts }, { onConflict: 'key' }),
      supabase.from('app_config').upsert({ key: 'extrasCatalog', value: currentExtras, updated_at: ts }, { onConflict: 'key' }),
      supabase.from('app_config').upsert({ key: 'hardwareCatalog', value: currentHardware, updated_at: ts }, { onConflict: 'key' }),
    ]);
    const hasError = results.some(r => r.error);
    setSaving(false);
    setChangedItems(new Set());
    setChangedFabrics(new Set());
    setChangedTrims(new Set());
    setChangedExtras(new Set());
    setChangedHardware(new Set());
    clearCatalogsCache();
    if (!hasError) {
      toast.success('Каталог сохранён');
    } else {
      toast.warning('Сохранено локально (Supabase недоступен)');
    }
  }, []);

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
      density: null, priceUSD: 10.00, forCategories: ['tshirts'],
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
      name: 'Новая отделка', supplier: 'Медас', priceUSD: 13.20,
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

  // ── CB Rate ──
  const fetchCbRate = async () => {
    try {
      const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
      const data = await r.json();
      const usd = data?.Valute?.USD?.Value;
      if (usd) {
        const rate = Math.round(usd * 100) / 100;
        const date = new Date().toISOString().slice(0, 10);
        setCbRate(rate);
        setCbDate(date);
        localStorage.setItem('ph_cb_rate', JSON.stringify({ rate, date }));
      }
    } catch { /* ignore fetch errors */ }
  };

  // ── Excel Export/Import ──
  const exportExcel = () => {
    if (!window.XLSX) { alert('XLSX не загружен'); return; }
    const wb = window.XLSX.utils.book_new();
    const skuData = skuCatalog.map(s => ({
      'Артикул': s.code, 'Название': s.name, 'Категория': s.category,
      'Fit': s.fit || '', 'Пошив ₽': s.sewingPrice, 'Расход осн. м': s.mainFabricUsage,
      'Отделка код': s.trimCode || '', 'Расход отд. м': s.trimUsage || 0,
      'Зоны': (s.zones || []).join(','),
    }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(skuData), 'SKU');
    const fabData = fabricsCatalog.map(f => ({
      'Код': f.code, 'Название': f.name, '$ за метр': f.priceUSD,
      'Категории': (f.forCategories || []).join(','), 'Поставщик': f.supplier || '',
    }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(fabData), 'Ткани');
    const trimData = trimCatalog.map(t => ({ 'Код': t.code, 'Название': t.name, '$ за метр': t.priceUSD }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(trimData), 'Отделка');
    const extData = extrasCatalog.map(e => ({ 'Код': e.code, 'Название': e.name, 'Цена ₽': e.price }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(extData), 'Обработки');
    const hwData = hardwareCatalog.map(h => ({ 'Код': h.code, 'Название': h.name, 'Цена ₽': h.price, 'Группа': h.group }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(hwData), 'Фурнитура');
    window.XLSX.writeFile(wb, 'pinhead-sku-catalog.xlsx');
  };

  const importExcel = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file || !window.XLSX) return;
      const data = await file.arrayBuffer();
      const wb = window.XLSX.read(data);
      const skuSheet = wb.Sheets['SKU'];
      if (skuSheet) {
        const rows = window.XLSX.utils.sheet_to_json(skuSheet);
        const items = rows.map(r => ({
          code: r['Артикул'] || '', name: r['Название'] || '', category: r['Категория'] || 'tshirts',
          fit: r['Fit'] || 'regular', sewingPrice: Number(r['Пошив ₽']) || 200,
          mainFabricUsage: Number(r['Расход осн. м']) || 1.0,
          trimCode: r['Отделка код'] || null, trimUsage: Number(r['Расход отд. м']) || 0,
          mockupType: 'tee', zones: (r['Зоны'] || '').split(',').filter(Boolean),
        }));
        setField('skuCatalog', items);
      }
      const fabSheet = wb.Sheets['Ткани'];
      if (fabSheet) {
        const rows = window.XLSX.utils.sheet_to_json(fabSheet);
        setField('fabricsCatalog', rows.map(r => ({
          code: r['Код'] || '', name: r['Название'] || '', priceUSD: Number(r['$ за метр']) || 3,
          forCategories: (r['Категории'] || '').split(',').filter(Boolean), supplier: r['Поставщик'] || '',
        })));
      }
      const trimSheet = wb.Sheets['Отделка'];
      if (trimSheet) {
        const rows = window.XLSX.utils.sheet_to_json(trimSheet);
        setField('trimCatalog', rows.map(r => ({ code: r['Код'] || '', name: r['Название'] || '', priceUSD: Number(r['$ за метр']) || 2.5 })));
      }
    };
    input.click();
  };

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
    if (fabricSearch.trim()) {
      const q = fabricSearch.toLowerCase();
      items = items.filter(f => (f.name || '').toLowerCase().includes(q) || (f.composition || '').toLowerCase().includes(q));
    }
    return items;
  }, [fabricsCatalog, fabricSupplierFilter, fabricSearch]);

  const estimatePrice = (s) => {
    const fabric = fabricsCatalog.find(f => (f.forCategories || []).includes(s.category));
    const fabricCost = fabric ? Math.round(s.mainFabricUsage * fabric.priceUSD * usdRate) : 0;
    const trim = trimCatalog.find(t => t.code === s.trimCode);
    const trimCost = trim ? Math.round((s.trimUsage || 0) * trim.priceUSD * usdRate) : 0;
    return s.sewingPrice + fabricCost + trimCost;
  };

  return (
    <div className="sku-ed-overlay">
      <div className="sku-ed-panel">
      {/* ── Actions bar ── */}
      <div className="sku-actions-bar">
        <span className="sku-actions-title">Каталог SKU</span>
        <div className="sku-actions-right">
          <button className="pe-btn" onClick={exportExcel}>Excel ↓</button>
          <button className="pe-btn" onClick={importExcel}>Excel ↑</button>
          <button className="pe-btn pe-btn-primary" onClick={saveAll} disabled={saving}>{saving ? 'Сохраняю...' : 'Сохранить'}</button>
        </div>
      </div>

      {/* ── Exchange Rate Bar ── */}
      <div className="sku-ed-rate-bar">
        <div className="sku-ed-rate-cb">
          <span>КУРС ЦБ:</span>
          <b>{cbRate ? `${cbRate}` : '—'}</b>
          {cbDate && <span className="sku-ed-rate-date">({cbDate})</span>}
          <span>₽/$</span>
          <button className="sku-ed-rate-refresh" onClick={fetchCbRate} title="Обновить курс ЦБ">↻</button>
        </div>
        <div className="sku-ed-rate-internal">
          <span>ВНУТРЕННИЙ:</span>
          <input
            type="number"
            value={usdRate}
            onChange={e => setField('usdRate', Math.max(1, Number(e.target.value) || 1))}
          />
          <span>₽/$</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="pe-tabs">
        {TABS.map(t => {
          const dirty = { items: changedItems, fabrics: changedFabrics, trims: changedTrims, extras: changedExtras, hardware: changedHardware }[t.id];
          return (
            <button key={t.id} className={`pe-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.name}{dirty?.size > 0 && <span className="pe-tab-dot" />}
            </button>
          );
        })}
      </div>

      {tab === 'items' && (
        <SkuItemsTab
          search={search} setSearch={setSearch} catFilter={catFilter} setCatFilter={setCatFilter}
          filteredSku={filteredSku} groupedSku={groupedSku} skuCatalog={skuCatalog} trimCatalog={trimCatalog}
          updateSku={updateSku} deleteSku={deleteSku} estimatePrice={estimatePrice}
          setShowAddModal={setShowAddModal} setShowZonesModal={setShowZonesModal}
          onPersist={saveAll}
        />
      )}

      {tab === 'fabrics' && (
        <SkuFabricsTab
          fabricSupplierFilter={fabricSupplierFilter} setFabricSupplierFilter={setFabricSupplierFilter}
          fabricSearch={fabricSearch} setFabricSearch={setFabricSearch}
          filteredFabrics={filteredFabrics} fabricsCatalog={fabricsCatalog}
          changedFabrics={changedFabrics} usdRate={usdRate}
          updateFabric={updateFabric} addFabric={addFabric} deleteFabric={deleteFabric}
        />
      )}

      {tab === 'trims' && (
        <SkuTrimsTab
          trimCatalog={trimCatalog} changedTrims={changedTrims} usdRate={usdRate}
          updateTrim={updateTrim} addTrim={addTrim} deleteTrim={deleteTrim}
        />
      )}

      {tab === 'extras' && (
        <ExtrasEditor
          extras={extrasCatalog}
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
          hardwareCatalog={hardwareCatalog}
          updateHardware={updateHardware} addHardware={addHardware} deleteHardware={deleteHardware}
        />
      )}

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
    </div>
  );
}
