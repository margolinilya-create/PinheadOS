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

const initialState = {
  step: 0,
  maxStep: 0,
  // ─── Editing state (для loadOrder/updateOrder) ───
  _editingOrderId: null,
  _editingOrderNumber: null,
  _lastSavedOrderNum: null,
  type: '',
  fabric: '',
  color: '',
  sku: null,
  sizes: initSizes(),
  customSizes: [],
  fit: 'regular',
  fitChosen: false,
  extras: [],
  labels: [],
  zones: [],
  tech: 'screen',
  textileColor: 'white',
  zoneTechs: {},
  zonePrints: {},
  flexZones: {},
  dtgZones: {},
  embZones: {},
  dtfZones: {},
  zoneArtworks: {},
  designNotes: '',
  sizeComment: '',
  phone: '',
  messenger: '',
  bitrixDeal: '',
  role: 'manager',
  name: '',
  contact: '',
  email: '',
  deadline: '',
  address: '',
  notes: '',
  packOption: false,
  urgentOption: false,
  noPrint: false,
  labelConfig: {
    careLabel: { enabled: false, logoOption: 'no-logo', composition: '', country: '', uploadData: null, comments: '' },
    mainLabel: { option: 'none', placement: 'neck', material: 'woven', color: 'white', uploadData: null, comments: '' },
    hangTag:   { option: 'none', uploadData: null, comments: '' },
  },
  colorSupplier: 'medastex',
  skuFilter: 'all',

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

  // ─── Navigation ───
  goToStep: (n) => set(s => {
    if (n > s.maxStep) return {};
    return { step: n };
  }),
  nextStep: () => set(s => {
    const next = Math.min(s.step + 1, 4);
    return { step: next, maxStep: Math.max(s.maxStep, next) };
  }),
  prevStep: () => set(s => ({ step: Math.max(s.step - 1, 0) })),

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
    let sku = null;
    if (d.sku?.code) {
      sku = skuCatalog.find(s => s.code === d.sku.code) || null;
    } else if (d.sku?.article) {
      sku = skuCatalog.find(s => s.article === d.sku.article) || null;
    }

    set({
      step: 4,
      maxStep: 4,
      _editingOrderId: order.id,
      _editingOrderNumber: order.order_number,
      _lastSavedOrderNum: null,
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
      dtgTextile: d.dtgTextile || 'white',
      zoneTechs: d.zoneTechs ? { ...d.zoneTechs } : {},
      zonePrints: d.zonePrints ? JSON.parse(JSON.stringify(d.zonePrints)) : {},
      flexZones: d.flexZones ? JSON.parse(JSON.stringify(d.flexZones)) : {},
      dtgZones: d.dtgZones ? JSON.parse(JSON.stringify(d.dtgZones)) : {},
      embZones: d.embZones ? JSON.parse(JSON.stringify(d.embZones)) : {},
      dtfZones: d.dtfZones ? JSON.parse(JSON.stringify(d.dtfZones)) : {},
      zoneArtworks: d.zoneArtworks ? { ...d.zoneArtworks } : {},
      designNotes: d.designNotes || '',
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
      noPrint: (d.zones || []).length === 0,
      labelConfig: d.labelConfig || initialState.labelConfig,
    });
  },

  // ─── Reset ───
  resetOrder: () => set({ ...initialState, skuCatalog: get().skuCatalog, fabricsCatalog: get().fabricsCatalog, trimCatalog: get().trimCatalog, extrasCatalog: get().extrasCatalog, labelsCatalog: get().labelsCatalog, usdRate: get().usdRate }),
}));
