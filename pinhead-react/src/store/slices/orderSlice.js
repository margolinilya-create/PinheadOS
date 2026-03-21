// Order slice: loadOrder, restoreFromDraft, resetOrder, editing state, saved
import { snapshotItem, restoreItem, defaultItemFields, initSizes, ITEM_FIELDS } from './helpers';
import { PRICES, SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT, LABELS_CATALOG_DEFAULT } from '../../data';

// Initial state values that resetOrder needs to restore
const resetFields = {
  step: 0,
  maxStep: 0,
  _editingOrderId: null,
  _editingOrderNumber: null,
  _lastSavedOrderNum: null,
  saved: false,
  items: [],
  activeItemIdx: -1,
  ...defaultItemFields,
  phone: '', messenger: '', bitrixDeal: '', role: 'manager',
  name: '', contact: '', email: '', deadline: '', address: '', notes: '',
  packOption: false, urgentOption: false,
};

export const orderSlice = (set, get) => ({
  _editingOrderId: null,
  _editingOrderNumber: null,
  _lastSavedOrderNum: null,
  saved: false,

  loadOrder: (order) => {
    const d = order.data || {};
    const skuCatalog = get().skuCatalog;

    function resolveSku(skuData) {
      if (!skuData) return null;
      if (skuData.code) return skuCatalog.find(s => s.code === skuData.code) || skuData;
      if (skuData.article) return skuCatalog.find(s => s.article === skuData.article) || skuData;
      return skuData;
    }

    let sku = resolveSku(d.sku);

    let items;
    if (Array.isArray(d.items) && d.items.length > 0) {
      items = d.items.map(it => {
        const restored = { ...it };
        restored.sku = resolveSku(it.sku);
        if (restored.sku && Array.isArray(restored.zones)) {
          const available = restored.sku.zones || [];
          restored.zones = restored.zones.filter(z => available.includes(z));
        }
        return restored;
      });
    } else {
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
        zones: d.zones ? (d.zones.filter(z => !sku || !sku.zones || sku.zones.includes(z))) : [],
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
        labelConfig: d.labelConfig || defaultItemFields.labelConfig,
      })];
    }

    const firstItem = items[0] || {};

    set({
      step: 5,
      maxStep: 5,
      _editingOrderId: order.id,
      _editingOrderNumber: order.order_number,
      _lastSavedOrderNum: null,
      items,
      activeItemIdx: 0,
      ...restoreItem(firstItem),
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

  restoreFromDraft: (data) => set(_s => ({
    ...data,
    maxStep: data.step || 0,
  })),

  resetOrder: () => {
    localStorage.removeItem('pinhead_draft');
    set({
      ...resetFields,
      prices: get().prices,
      skuCatalog: get().skuCatalog,
      fabricsCatalog: get().fabricsCatalog,
      trimCatalog: get().trimCatalog,
      extrasCatalog: get().extrasCatalog,
      labelsCatalog: get().labelsCatalog,
      usdRate: get().usdRate,
    });
  },
});
