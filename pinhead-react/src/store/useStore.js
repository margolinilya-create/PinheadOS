// ═══════════════════════════════════════════
// Zustand store — глобальное состояние заказа
// ═══════════════════════════════════════════
import { create } from 'zustand';
import { SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT, LABELS_CATALOG_DEFAULT, SIZES } from '../data';

// Начальные размеры {2XS:0, XS:0, ...}
const initSizes = () => Object.fromEntries(SIZES.map(s => [s, 0]));

// Порядок размеров для сортировки (от маленького к большому)
const SIZE_ORDER_MAP = { '3XS': 1, '2XS': 2, 'XS': 3, 'S': 4, 'M': 5, 'L': 6, 'XL': 7, '2XL': 8, '3XL': 9, '4XL': 10, '5XL': 11, '6XL': 12, '7XL': 13, '8XL': 14, '9XL': 15, '10XL': 16 };
function sizeOrder(label) {
  const up = (label || '').toUpperCase().trim();
  if (SIZE_ORDER_MAP[up]) return SIZE_ORDER_MAP[up];
  // Числовой размер (28, 30, 32, ...)
  const num = parseInt(up);
  if (!isNaN(num)) return 100 + num;
  // Неизвестный — в конец
  return 999;
}

// ─── Поля позиции (line item) ───
const ITEM_FIELDS = [
  'type', 'fabric', 'color', 'sku', 'sizes', 'customSizes', 'fit', 'fitChosen',
  'extras', 'labels', 'zones', 'tech', 'textileColor', 'zoneTechs', 'zonePrints',
  'flexZones', 'dtgZones', 'embZones', 'dtfZones', 'zoneArtworks', 'designNotes',
  'sizeComment', 'noPrint', 'labelConfig', 'colorSupplier', 'skuFilter',
];

const defaultItemFields = {
  type: '', fabric: '', color: '', sku: null,
  sizes: initSizes(), customSizes: [], fit: 'regular', fitChosen: false,
  extras: [], labels: [],
  zones: [], tech: 'screen', textileColor: 'white',
  zoneTechs: {}, zonePrints: {}, flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {},
  zoneArtworks: {}, designNotes: '', sizeComment: '', noPrint: false,
  labelConfig: {
    careLabel: { enabled: false, logoOption: 'no-logo', composition: '', country: '', uploadData: null, comments: '' },
    mainLabel: { option: 'none', placement: 'neck', material: 'woven', color: 'white', uploadData: null, comments: '' },
    hangTag:   { option: 'none', uploadData: null, comments: '' },
  },
  colorSupplier: 'medastex', skuFilter: 'all',
};

function snapshotItem(state) {
  const item = {};
  for (const k of ITEM_FIELDS) {
    const v = state[k];
    item[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  }
  return item;
}

function restoreItem(item) {
  const patch = {};
  for (const k of ITEM_FIELDS) {
    if (k in item) {
      const v = item[k];
      patch[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    }
  }
  return patch;
}

const initialState = {
  step: 0,
  maxStep: 0,
  // ─── Editing state (для loadOrder/updateOrder) ───
  _editingOrderId: null,
  _editingOrderNumber: null,
  _lastSavedOrderNum: null,

  // ─── Multi-item ───
  items: [],           // массив снэпшотов позиций
  activeItemIdx: -1,   // -1 = новая позиция, 0+ = редактирование существующей

  // ─── Текущая позиция (редактируемая) ───
  ...defaultItemFields,

  // ─── Общие поля заказа ───
  phone: '', messenger: '', bitrixDeal: '', role: 'manager',
  name: '', contact: '', email: '', deadline: '', address: '', notes: '',
  packOption: false, urgentOption: false,

  // Редактируемые каталоги (загружаются из localStorage)
  skuCatalog: SKU_CATALOG_DEFAULT,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  labelsCatalog: LABELS_CATALOG_DEFAULT,
  usdRate: 92,
};

export const useStore = create((set, get) => ({
  ...initialState,

  // ─── Navigation (6 шагов: 0-Garment, 1-Extras, 2-Design, 3-Items, 4-Details, 5-Summary) ───
  goToStep: (n) => set(s => {
    if (n > s.maxStep) return {};
    return { step: n };
  }),
  nextStep: () => set(s => {
    // При переходе со step 2 → 3 автосохраняем текущую позицию
    if (s.step === 2) {
      const snap = snapshotItem(s);
      const items = [...s.items];
      if (s.activeItemIdx >= 0 && s.activeItemIdx < items.length) {
        items[s.activeItemIdx] = snap;
      } else {
        items.push(snap);
      }
      const next = 3;
      return { step: next, maxStep: Math.max(s.maxStep, next), items, activeItemIdx: items.length - 1 };
    }
    const next = Math.min(s.step + 1, 5);
    return { step: next, maxStep: Math.max(s.maxStep, next) };
  }),
  prevStep: () => set(s => {
    // При переходе со step 3 → 2 загружаем последнюю позицию
    if (s.step === 3 && s.items.length > 0) {
      const idx = s.activeItemIdx >= 0 ? s.activeItemIdx : s.items.length - 1;
      return { step: 2, ...restoreItem(s.items[idx]), activeItemIdx: idx };
    }
    return { step: Math.max(s.step - 1, 0) };
  }),

  // ─── Multi-item management ───
  saveCurrentItem: () => set(s => {
    const snap = snapshotItem(s);
    const items = [...s.items];
    if (s.activeItemIdx >= 0 && s.activeItemIdx < items.length) {
      items[s.activeItemIdx] = snap;
    } else {
      items.push(snap);
    }
    return { items, activeItemIdx: items.length - 1 };
  }),
  addNewItem: () => set(s => {
    return { ...restoreItem(defaultItemFields), activeItemIdx: -1, step: 0, maxStep: Math.max(s.maxStep, 3) };
  }),
  editItem: (idx) => set(s => {
    if (idx < 0 || idx >= s.items.length) return {};
    return { ...restoreItem(s.items[idx]), activeItemIdx: idx, step: 0, maxStep: Math.max(s.maxStep, 3) };
  }),
  removeItem: (idx) => set(s => {
    const items = s.items.filter((_, i) => i !== idx);
    const activeItemIdx = s.activeItemIdx === idx ? -1 : s.activeItemIdx > idx ? s.activeItemIdx - 1 : s.activeItemIdx;
    return { items, activeItemIdx };
  }),

  // ─── SKU selection ───
  selectSku: (sku) => set(s => {
    const CAT_TO_TYPE = {
      tshirts:'tee', longsleeves:'longsleeve', tanks:'tank',
      hoodies:'hoodie', sweatshirts:'sweat', ziphoodies:'zip-hoodie',
      pants:'pants', shorts:'shorts', accessories:'shopper',
    };
    const type = sku.mockupType || CAT_TO_TYPE[sku.category] || sku.category;
    const prevType = s.type;
    const needReset = prevType !== type || !s.sku || s.sku.code !== sku.code;
    return {
      sku,
      type,
      fit: sku.fit || 'regular',
      fitChosen: true,
      ...(needReset ? {
        fabric: '',
        color: '',
        extras: [],
        labels: [],
        zones: sku.zones?.length ? [sku.zones[0]] : [],
        zoneTechs: {},
        zonePrints: {},
        dtgZones: {},
        embZones: {},
        dtfZones: {},
      } : {}),
    };
  }),
  setSkuFilter: (f) => set({ skuFilter: f }),
  reorderSku: (fromCode, toCode) => set(s => {
    const arr = [...s.skuCatalog];
    const fromIdx = arr.findIndex(x => x.code === fromCode);
    const toIdx = arr.findIndex(x => x.code === toCode);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return {};
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    return { skuCatalog: arr };
  }),

  // ─── Fabric & Color ───
  selectFabric: (key) => set(s => ({
    fabric: key,
    ...(s.fabric !== key ? { color: '' } : {}),
  })),
  selectColor: (code) => set({ color: code }),
  setColorSupplier: (sup) => set({ colorSupplier: sup }),

  // ─── Fit ───
  selectFit: (fit) => set(s => ({
    fit,
    fitChosen: true,
    ...(s.fit !== fit ? { fabric: '', color: '' } : {}),
  })),

  // ─── Sizes ───
  setSize: (size, qty) => set(s => ({
    sizes: { ...s.sizes, [size]: Math.max(0, parseInt(qty) || 0) },
  })),
  setOneSizeQty: (qty) => set({ sizes: { 'ONE SIZE': Math.max(1, parseInt(qty) || 1) } }),

  // ─── Extras ───
  toggleExtra: (code) => set(s => ({
    extras: s.extras.includes(code)
      ? s.extras.filter(c => c !== code)
      : [...s.extras, code],
  })),

  // ─── Zones & Tech ───
  toggleZone: (zone) => set(s => {
    const has = s.zones.includes(zone);
    const zones = has ? s.zones.filter(z => z !== zone) : [...s.zones, zone];
    const zoneTechs = { ...s.zoneTechs };
    const zonePrints = { ...s.zonePrints };
    if (!has) {
      if (!zoneTechs[zone]) zoneTechs[zone] = 'screen';
      if (!zonePrints[zone]) zonePrints[zone] = { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
    }
    return { zones, zoneTechs, zonePrints, noPrint: false };
  }),
  setZoneTech: (zone, tech) => set(s => {
    const zoneTechs = { ...s.zoneTechs, [zone]: tech };
    const updates = { zoneTechs, tech };
    if (tech === 'screen' && !s.zonePrints?.[zone])
      updates.zonePrints = { ...s.zonePrints, [zone]: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } };
    if (tech === 'flex' && !s.flexZones?.[zone])
      updates.flexZones = { ...s.flexZones, [zone]: { colors: 1, size: 'A4' } };
    if (tech === 'dtg' && !s.dtgZones?.[zone])
      updates.dtgZones = { ...s.dtgZones, [zone]: { size: 'A4', textile: 'white' } };
    if (tech === 'embroidery' && !s.embZones?.[zone])
      updates.embZones = { ...s.embZones, [zone]: { colors: 3, area: 's' } };
    if (tech === 'dtf' && !s.dtfZones?.[zone])
      updates.dtfZones = { ...s.dtfZones, [zone]: { size: 'A4' } };
    return updates;
  }),
  setZoneParam: (zone, tech, key, value) => set(s => {
    const map = { screen: 'zonePrints', flex: 'flexZones', dtg: 'dtgZones', embroidery: 'embZones', dtf: 'dtfZones' };
    const field = map[tech];
    if (!field) return {};
    return { [field]: { ...s[field], [zone]: { ...(s[field]?.[zone] || {}), [key]: value } } };
  }),
  toggleNoPrint: () => set(s => ({
    noPrint: !s.noPrint,
    ...(!s.noPrint ? { zones: [] } : {}),
  })),
  setZoneArtwork: (zone, url) => set(s => ({
    zoneArtworks: { ...s.zoneArtworks, [zone]: url },
  })),

  // ─── Details ───
  setField: (field, value) => set({ [field]: value }),

  // ─── Labels ───
  setLabelConfig: (section, key, value) => set(s => ({
    labelConfig: {
      ...s.labelConfig,
      [section]: { ...s.labelConfig[section], [key]: value },
    },
  })),
  toggleCareLabel: () => set(s => ({
    labelConfig: {
      ...s.labelConfig,
      careLabel: { ...s.labelConfig.careLabel, enabled: !s.labelConfig.careLabel.enabled },
    },
  })),

  // ─── Options ───
  togglePack: () => set(s => ({ packOption: !s.packOption })),
  toggleUrgent: () => set(s => ({ urgentOption: !s.urgentOption })),

  // ─── Custom Sizes ───
  addCustomSize: (label) => set(s => {
    const newLabel = label || `${s.customSizes.length + 4}XL`;
    const updated = [...s.customSizes, { label: newLabel, qty: 0 }];
    updated.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
    return { customSizes: updated };
  }),
  removeCustomSize: (idx) => set(s => ({
    customSizes: s.customSizes.filter((_, i) => i !== idx),
  })),
  setCustomSizeQty: (idx, qty) => set(s => ({
    customSizes: s.customSizes.map((c, i) => i === idx ? { ...c, qty: Math.max(0, parseInt(qty) || 0) } : c),
  })),
  setCustomSizeLabel: (idx, label) => set(s => {
    const updated = s.customSizes.map((c, i) => i === idx ? { ...c, label } : c);
    updated.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
    return { customSizes: updated };
  }),

  // ─── Load Order (восстановление из Supabase данных) ───
  loadOrder: (order) => {
    const d = order.data || {};
    const skuCatalog = get().skuCatalog;

    // Restore SKU from catalog by article/code
    function resolveSku(skuData) {
      if (!skuData) return null;
      if (skuData.code) return skuCatalog.find(s => s.code === skuData.code) || null;
      if (skuData.article) return skuCatalog.find(s => s.article === skuData.article) || null;
      return null;
    }

    let sku = resolveSku(d.sku);

    // Backward compat: если items[] есть — загружаем; иначе формируем из плоских полей
    let items;
    if (Array.isArray(d.items) && d.items.length > 0) {
      items = d.items.map(it => {
        const restored = { ...it };
        restored.sku = resolveSku(it.sku);
        return restored;
      });
    } else {
      // Старый формат — одна позиция из плоских полей
      items = [snapshotItem({
        ...defaultItemFields,
        type: d.type || '',
        fabric: d.fabric || '',
        color: d.color || '',
        sku,
        fit: d.fit || 'regular',
        fitChosen: !!d.fit || !!sku,
        sizes: d.sizes ? { ...d.sizes } : initSizes(),
        customSizes: d.customSizes ? [...d.customSizes] : [],
        extras: d.extras ? [...d.extras] : [],
        labels: d.labels ? [...d.labels] : [],
        zones: d.zones ? [...d.zones] : [],
        tech: d.tech || 'screen',
        textileColor: d.textileColor || 'white',
        zoneTechs: d.zoneTechs ? { ...d.zoneTechs } : {},
        zonePrints: d.zonePrints ? JSON.parse(JSON.stringify(d.zonePrints)) : {},
        flexZones: d.flexZones ? JSON.parse(JSON.stringify(d.flexZones)) : {},
        dtgZones: d.dtgZones ? JSON.parse(JSON.stringify(d.dtgZones)) : {},
        embZones: d.embZones ? JSON.parse(JSON.stringify(d.embZones)) : {},
        dtfZones: d.dtfZones ? JSON.parse(JSON.stringify(d.dtfZones)) : {},
        zoneArtworks: d.zoneArtworks ? { ...d.zoneArtworks } : {},
        designNotes: d.designNotes || '',
        sizeComment: d.sizeComment || '',
        noPrint: (d.zones || []).length === 0,
        labelConfig: d.labelConfig || initialState.labelConfig,
      })];
    }

    // Загружаем первую позицию в текущие поля
    const firstItem = items[0] || {};

    set({
      step: 5,
      maxStep: 5,
      _editingOrderId: order.id,
      _editingOrderNumber: order.order_number,
      _lastSavedOrderNum: null,
      items,
      activeItemIdx: 0,
      // Восстанавливаем текущую позицию из первой
      ...restoreItem(firstItem),
      // Общие поля
      name: d.name || '',
      contact: d.contact || '',
      email: d.email || '',
      phone: d.phone || '',
      bitrixDeal: d.bitrixDeal || order.bitrix_deal || '',
      deadline: d.deadline || '',
      address: d.address || '',
      notes: d.notes || '',
      packOption: d.packOption || false,
      urgentOption: d.urgentOption || false,
    });
  },

  // ─── Reset ───
  resetOrder: () => set({ ...initialState, skuCatalog: get().skuCatalog, fabricsCatalog: get().fabricsCatalog, trimCatalog: get().trimCatalog, extrasCatalog: get().extrasCatalog, labelsCatalog: get().labelsCatalog, usdRate: get().usdRate }),
}));

export { ITEM_FIELDS, snapshotItem, restoreItem, defaultItemFields };
