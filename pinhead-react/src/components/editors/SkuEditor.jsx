import { useState, useMemo, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { SKU_CATEGORIES } from '../../data/skuCatalog';
import { TRIM_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT, HARDWARE_GROUPS, HARDWARE_CATALOG_DEFAULT } from '../../data/extras';
import { ZONE_LABELS } from '../../data/constants';

const ALL_ZONES = [
  {id:'front', name:'Грудь (перед)'},
  {id:'back', name:'Спина'},
  {id:'sleeve-l', name:'Левый рукав'},
  {id:'sleeve-r', name:'Правый рукав'},
  {id:'hood', name:'Капюшон'},
  {id:'pocket', name:'Карман'},
  {id:'side-a', name:'Сторона A'},
  {id:'side-b', name:'Сторона B'},
];

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

export default function SkuEditor({ onBack }) {
  const store = useStore();
  const { skuCatalog, fabricsCatalog, trimCatalog, usdRate, setField } = store;
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
  const [showZonesModal, setShowZonesModal] = useState(null); // index of sku item
  const [addForm, setAddForm] = useState({ name: '', category: 'tshirts', fit: 'regular' });

  // Extras & hardware from store or defaults
  const [extrasCatalog, setExtrasCatalog] = useState(() => {
    try { const s = localStorage.getItem('ph_extras'); return s ? JSON.parse(s) : [...EXTRAS_CATALOG_DEFAULT]; } catch { return [...EXTRAS_CATALOG_DEFAULT]; }
  });
  const [hardwareCatalog, setHardwareCatalog] = useState(() => {
    try { const s = localStorage.getItem('ph_hardware'); return s ? JSON.parse(s) : [...HARDWARE_CATALOG_DEFAULT]; } catch { return [...HARDWARE_CATALOG_DEFAULT]; }
  });

  const saveAll = useCallback(() => {
    try {
      localStorage.setItem('ph_sku', JSON.stringify(skuCatalog));
      localStorage.setItem('ph_fabrics', JSON.stringify(fabricsCatalog));
      localStorage.setItem('ph_trims', JSON.stringify(trimCatalog));
      localStorage.setItem('ph_extras', JSON.stringify(extrasCatalog));
      localStorage.setItem('ph_hardware', JSON.stringify(hardwareCatalog));
      localStorage.setItem('ph_usd_rate', String(usdRate));
    } catch {}
  }, [skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, hardwareCatalog, usdRate]);

  // ── SKU CRUD ──
  const updateSku = (idx, field, value) => {
    const updated = skuCatalog.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    setField('skuCatalog', updated);
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
  };
  const addFabric = () => {
    setField('fabricsCatalog', [...fabricsCatalog, {
      code: generateCode('новая-ткань-' + (fabricsCatalog.length + 1)),
      name: 'Новая ткань',
      priceUSD: 3.00,
      forCategories: ['tshirts'],
      supplier: '—',
    }]);
  };
  const deleteFabric = (idx) => {
    setField('fabricsCatalog', fabricsCatalog.filter((_, i) => i !== idx));
  };
  const toggleFabricCat = (idx, catId) => {
    const f = fabricsCatalog[idx];
    const cats = f.forCategories || [];
    const updated = cats.includes(catId) ? cats.filter(c => c !== catId) : [...cats, catId];
    updateFabric(idx, 'forCategories', updated);
  };

  // ── Trim CRUD ──
  const updateTrim = (idx, field, value) => {
    const updated = trimCatalog.map((t, i) => i === idx ? { ...t, [field]: value } : t);
    setField('trimCatalog', updated);
  };
  const addTrim = () => {
    setField('trimCatalog', [...trimCatalog, {
      code: generateCode('новая-отделка-' + (trimCatalog.length + 1)),
      name: 'Новая отделка',
      priceUSD: 2.50,
    }]);
  };
  const deleteTrim = (idx) => {
    setField('trimCatalog', trimCatalog.filter((_, i) => i !== idx));
  };

  // ── Extras CRUD ──
  const updateExtra = (idx, field, value) => {
    setExtrasCatalog(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };
  const addExtra = () => {
    setExtrasCatalog(prev => [...prev, { code: generateCode('новая-обработка-' + (prev.length + 1)), name: 'Новая обработка', price: 30 }]);
  };
  const deleteExtra = (idx) => {
    setExtrasCatalog(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Hardware CRUD ──
  const updateHardware = (idx, field, value) => {
    setHardwareCatalog(prev => prev.map((h, i) => i === idx ? { ...h, [field]: value } : h));
  };
  const addHardware = (group) => {
    setHardwareCatalog(prev => [...prev, { code: generateCode('новая-фурн-' + (prev.length + 1)), name: 'Новая фурнитура', price: 20, group }]);
  };
  const deleteHardware = (idx) => {
    setHardwareCatalog(prev => prev.filter((_, i) => i !== idx));
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
    } catch {}
  };

  // ── Excel Export ──
  const exportExcel = () => {
    if (!window.XLSX) { alert('XLSX не загружен'); return; }
    const wb = window.XLSX.utils.book_new();
    // Sheet 1: SKU
    const skuData = skuCatalog.map(s => ({
      'Артикул': s.code, 'Название': s.name, 'Категория': s.category,
      'Fit': s.fit || '', 'Пошив ₽': s.sewingPrice, 'Расход осн. м': s.mainFabricUsage,
      'Отделка код': s.trimCode || '', 'Расход отд. м': s.trimUsage || 0,
      'Зоны': (s.zones || []).join(','),
    }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(skuData), 'SKU');
    // Sheet 2: Ткани
    const fabData = fabricsCatalog.map(f => ({
      'Код': f.code, 'Название': f.name, '$ за метр': f.priceUSD,
      'Категории': (f.forCategories || []).join(','), 'Поставщик': f.supplier || '',
    }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(fabData), 'Ткани');
    // Sheet 3: Отделка
    const trimData = trimCatalog.map(t => ({ 'Код': t.code, 'Название': t.name, '$ за метр': t.priceUSD }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(trimData), 'Отделка');
    // Sheet 4: Обработки
    const extData = extrasCatalog.map(e => ({ 'Код': e.code, 'Название': e.name, 'Цена ₽': e.price }));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(extData), 'Обработки');
    // Sheet 5: Фурнитура
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
      // Read SKU sheet
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
      // Read Fabrics
      const fabSheet = wb.Sheets['Ткани'];
      if (fabSheet) {
        const rows = window.XLSX.utils.sheet_to_json(fabSheet);
        setField('fabricsCatalog', rows.map(r => ({
          code: r['Код'] || '', name: r['Название'] || '', priceUSD: Number(r['$ за метр']) || 3,
          forCategories: (r['Категории'] || '').split(',').filter(Boolean), supplier: r['Поставщик'] || '',
        })));
      }
      // Read Trims
      const trimSheet = wb.Sheets['Отделка'];
      if (trimSheet) {
        const rows = window.XLSX.utils.sheet_to_json(trimSheet);
        setField('trimCatalog', rows.map(r => ({ code: r['Код'] || '', name: r['Название'] || '', priceUSD: Number(r['$ за метр']) || 2.5 })));
      }
    };
    input.click();
  };

  // ── Filtered SKU ──
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

  const getCatName = (id) => SKU_CATEGORIES.find(c => c.id === id)?.name || id;

  // ── Estimate price for SKU ──
  const estimatePrice = (s) => {
    const fabric = fabricsCatalog.find(f => (f.forCategories || []).includes(s.category));
    const fabricCost = fabric ? Math.round(s.mainFabricUsage * fabric.priceUSD * usdRate) : 0;
    const trim = trimCatalog.find(t => t.code === s.trimCode);
    const trimCost = trim ? Math.round((s.trimUsage || 0) * trim.priceUSD * usdRate) : 0;
    return s.sewingPrice + fabricCost + trimCost;
  };

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="sku-ed-header">
        <div className="sku-ed-header-left">
          <button className="page-back-btn" onClick={() => { saveAll(); onBack(); }}>← В СТУДИЮ</button>
          <h1 className="sku-ed-title">КАТАЛОГ SKU <span>v.1.0</span></h1>
        </div>
        <div className="sku-ed-header-right">
          <button className="btn-secondary" onClick={exportExcel}>Excel ↓</button>
          <button className="btn-secondary" onClick={importExcel}>Excel ↑</button>
          <button className="btn-accent" onClick={saveAll}>Сохранить</button>
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
      <div className="page-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`page-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>

      {/* ══════ TAB: Изделия ══════ */}
      {tab === 'items' && (
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
                    <th className="sku-th-art">Артикул</th>
                    <th className="sku-th-name">Название</th>
                    <th className="sku-th-fit">Fit</th>
                    <th className="sku-th-price">Пошив</th>
                    <th className="sku-th-num2">Осн</th>
                    <th className="sku-th-num2">Отд</th>
                    <th className="sku-th-trim">Отделка</th>
                    <th className="sku-th-zones">Зоны</th>
                    <th className="sku-th-est">~Цена</th>
                    <th className="sku-th-del"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    const realIdx = skuCatalog.indexOf(s);
                    return (
                      <tr key={s.code + realIdx}>
                        <td className="sku-td-num">{realIdx + 1}</td>
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
                        <td className="sku-td-est">~{estimatePrice(s)} ₽</td>
                        <td>
                          <button className="sku-del-btn" onClick={() => deleteSku(realIdx)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ══════ TAB: Основная ткань ══════ */}
      {tab === 'fabrics' && (
        <div className="sku-ed-body">
          <div className="sku-ed-toolbar">
            <span className="sku-ed-count">Всего: {fabricsCatalog.length} тканей</span>
            <button className="sku-ed-add-btn" onClick={addFabric}>+ Добавить</button>
          </div>
          <table className="sku-ed-table">
            <thead>
              <tr>
                <th className="sku-th-num">№</th>
                <th className="sku-th-art">Код</th>
                <th className="sku-th-name">Название</th>
                <th className="sku-th-price">$/м</th>
                <th className="sku-th-price">₽/м</th>
                <th>Категории</th>
                <th className="sku-th-del"></th>
              </tr>
            </thead>
            <tbody>
              {fabricsCatalog.map((f, i) => (
                <tr key={f.code + i}>
                  <td className="sku-td-num">{i + 1}</td>
                  <td className="sku-td-art">{f.code}</td>
                  <td>
                    <input className="sku-edit-input sku-edit-name" value={f.name}
                      onChange={e => updateFabric(i, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input className="sku-edit-input sku-edit-num" type="number" step="0.1" value={f.priceUSD}
                      onChange={e => updateFabric(i, 'priceUSD', Number(e.target.value) || 0)} />
                  </td>
                  <td className="sku-td-est">{Math.round(f.priceUSD * usdRate)} ₽</td>
                  <td className="sku-td-cats">
                    {SKU_CATEGORIES.map(c => (
                      <button key={c.id}
                        className={`sku-cat-tag${(f.forCategories || []).includes(c.id) ? ' active' : ''}`}
                        onClick={() => toggleFabricCat(i, c.id)}>
                        {c.name}
                      </button>
                    ))}
                  </td>
                  <td><button className="sku-del-btn" onClick={() => deleteFabric(i)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════ TAB: Отделочная ткань ══════ */}
      {tab === 'trims' && (
        <div className="sku-ed-body">
          <div className="sku-ed-toolbar">
            <span className="sku-ed-count">Всего: {trimCatalog.length} отделок</span>
            <button className="sku-ed-add-btn" onClick={addTrim}>+ Добавить</button>
          </div>
          <table className="sku-ed-table">
            <thead>
              <tr>
                <th className="sku-th-num">№</th>
                <th className="sku-th-art">Код</th>
                <th className="sku-th-name">Название</th>
                <th className="sku-th-price">$/м</th>
                <th className="sku-th-price">₽/м</th>
                <th className="sku-th-del"></th>
              </tr>
            </thead>
            <tbody>
              {trimCatalog.map((t, i) => (
                <tr key={t.code + i}>
                  <td className="sku-td-num">{i + 1}</td>
                  <td className="sku-td-art">{t.code}</td>
                  <td>
                    <input className="sku-edit-input sku-edit-name" value={t.name}
                      onChange={e => updateTrim(i, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input className="sku-edit-input sku-edit-num" type="number" step="0.1" value={t.priceUSD}
                      onChange={e => updateTrim(i, 'priceUSD', Number(e.target.value) || 0)} />
                  </td>
                  <td className="sku-td-est">{Math.round(t.priceUSD * usdRate)} ₽</td>
                  <td><button className="sku-del-btn" onClick={() => deleteTrim(i)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════ TAB: Обработки ══════ */}
      {tab === 'extras' && (
        <div className="sku-ed-body">
          <div className="sku-ed-toolbar">
            <span className="sku-ed-count">Всего: {extrasCatalog.length} обработок</span>
            <button className="sku-ed-add-btn" onClick={addExtra}>+ Добавить</button>
          </div>
          <table className="sku-ed-table">
            <thead>
              <tr>
                <th className="sku-th-num">№</th>
                <th className="sku-th-art">Код</th>
                <th className="sku-th-name">Название</th>
                <th className="sku-th-price">Цена ₽</th>
                <th className="sku-th-del"></th>
              </tr>
            </thead>
            <tbody>
              {extrasCatalog.map((e, i) => (
                <tr key={e.code + i}>
                  <td className="sku-td-num">{i + 1}</td>
                  <td className="sku-td-art">{e.code}</td>
                  <td>
                    <input className="sku-edit-input sku-edit-name" value={e.name}
                      onChange={ev => updateExtra(i, 'name', ev.target.value)} />
                  </td>
                  <td>
                    <input className="sku-edit-input sku-edit-num" type="number" value={e.price}
                      onChange={ev => updateExtra(i, 'price', Number(ev.target.value) || 0)} />
                  </td>
                  <td><button className="sku-del-btn" onClick={() => deleteExtra(i)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════ TAB: Фурнитура ══════ */}
      {tab === 'hardware' && (
        <div className="sku-ed-body">
          {HARDWARE_GROUPS.map(g => {
            const items = hardwareCatalog.filter(h => h.group === g.id);
            return (
              <div key={g.id} className="sku-ed-group">
                <div className="sku-ed-group-header">
                  <span>{g.name}</span>
                  <span className="sku-ed-group-count">{items.length}</span>
                  <button className="sku-ed-add-btn-sm" onClick={() => addHardware(g.id)}>+</button>
                </div>
                <table className="sku-ed-table">
                  <thead>
                    <tr>
                      <th className="sku-th-num">№</th>
                      <th className="sku-th-art">Код</th>
                      <th className="sku-th-name">Название</th>
                      <th className="sku-th-price">Цена ₽</th>
                      <th className="sku-th-del"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((h) => {
                      const realIdx = hardwareCatalog.indexOf(h);
                      return (
                        <tr key={h.code + realIdx}>
                          <td className="sku-td-num">{realIdx + 1}</td>
                          <td className="sku-td-art">{h.code}</td>
                          <td>
                            <input className="sku-edit-input sku-edit-name" value={h.name}
                              onChange={e => updateHardware(realIdx, 'name', e.target.value)} />
                          </td>
                          <td>
                            <input className="sku-edit-input sku-edit-num" type="number" value={h.price}
                              onChange={e => updateHardware(realIdx, 'price', Number(e.target.value) || 0)} />
                          </td>
                          <td><button className="sku-del-btn" onClick={() => deleteHardware(realIdx)}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add SKU Modal ── */}
      {showAddModal && (
        <div className="sku-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="sku-modal" onClick={e => e.stopPropagation()}>
            <h3>Добавить изделие</h3>
            <div className="sku-modal-field">
              <label>НАЗВАНИЕ</label>
              <input value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="Название изделия" autoFocus />
            </div>
            <div className="sku-modal-field">
              <label>КАТЕГОРИЯ</label>
              <select value={addForm.category} onChange={e => setAddForm({ ...addForm, category: e.target.value })}>
                {SKU_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {addForm.category !== 'accessories' && (
              <div className="sku-modal-field">
                <label>FIT</label>
                <select value={addForm.fit} onChange={e => setAddForm({ ...addForm, fit: e.target.value })}>
                  <option value="regular">Regular</option>
                  <option value="free">Free</option>
                  <option value="oversize">Oversize</option>
                </select>
              </div>
            )}
            <div className="sku-modal-btns">
              <button className="btn-secondary" onClick={() => setShowAddModal(false)}>Отмена</button>
              <button className="btn-accent" onClick={addSku} disabled={!addForm.name.trim()}>Добавить</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Zone Selection Modal ── */}
      {showZonesModal !== null && (
        <div className="sku-modal-overlay" onClick={() => setShowZonesModal(null)}>
          <div className="sku-modal" onClick={e => e.stopPropagation()}>
            <h3>Зоны нанесения</h3>
            <p className="sku-modal-hint">{skuCatalog[showZonesModal]?.name}</p>
            <div className="sku-zones-grid">
              {ALL_ZONES.filter(z => {
                const cat = skuCatalog[showZonesModal]?.category;
                if (cat === 'accessories') return ['side-a', 'side-b'].includes(z.id);
                return !['side-a', 'side-b'].includes(z.id);
              }).map(z => {
                const item = skuCatalog[showZonesModal];
                const active = (item?.zones || []).includes(z.id);
                return (
                  <label key={z.id} className={`sku-zone-check${active ? ' active' : ''}`}>
                    <input type="checkbox" checked={active}
                      onChange={() => {
                        const zones = item.zones || [];
                        const newZones = active ? zones.filter(x => x !== z.id) : [...zones, z.id];
                        updateSku(showZonesModal, 'zones', newZones);
                      }} />
                    <span>{z.name}</span>
                  </label>
                );
              })}
            </div>
            <div className="sku-modal-btns">
              <button className="btn-accent" onClick={() => setShowZonesModal(null)}>Готово</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
