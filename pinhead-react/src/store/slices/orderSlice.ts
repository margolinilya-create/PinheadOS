// Order slice: loadOrder, restoreFromDraft, resetOrder, editing state, saved
import { snapshotItem, restoreItem, defaultItemFields, initSizes, ITEM_FIELDS } from './helpers';
import { PRICES, SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT, LABELS_CATALOG_DEFAULT } from '../../data';
import type { Order } from '../../types/order';
import type { SkuItem } from '../../types/catalog';

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;
type GetFn = () => Record<string, unknown>;

// Initial state values that resetOrder needs to restore
const resetFields: Record<string, unknown> = {
  step: 0,
  maxStep: 0,
  _editingOrderId: null,
  _editingOrderNumber: null,
  _lastSavedOrderNum: null,
  saved: false,
  items: [],
  activeItemIdx: -1,
  ...(defaultItemFields as unknown as Record<string, unknown>),
  phone: '', messenger: '', bitrixDeal: '', role: 'manager',
  name: '', contact: '', email: '', deadline: '', address: '', notes: '',
  packOption: false, packType: 'none', urgentOption: false,
};

export const orderSlice = (set: SetFn, get: GetFn) => ({
  _editingOrderId: null as string | null,
  _editingOrderNumber: null as string | null,
  _lastSavedOrderNum: null as string | null,
  saved: false,

  loadOrder: (order: Order) => {
    const d = (order.data || {}) as Record<string, unknown>;
    const skuCatalog = get().skuCatalog as SkuItem[];

    function resolveSku(skuData: unknown): SkuItem | null {
      if (!skuData) return null;
      const data = skuData as Record<string, unknown>;
      if (data.code) return skuCatalog.find(s => s.code === data.code) || data as unknown as SkuItem;
      if (data.article) return skuCatalog.find(s => (s as unknown as Record<string, unknown>).article === data.article) || data as unknown as SkuItem;
      return data as unknown as SkuItem;
    }

    const sku = resolveSku(d.sku);

    let items: Record<string, unknown>[];
    if (Array.isArray(d.items) && d.items.length > 0) {
      items = (d.items as Record<string, unknown>[]).map((it: Record<string, unknown>) => {
        const restored: Record<string, unknown> = { ...it };
        restored.sku = resolveSku(it.sku);
        if (restored.sku && Array.isArray(restored.zones)) {
          const available = (restored.sku as SkuItem).zones || [];
          restored.zones = (restored.zones as string[]).filter((z: string) => available.includes(z));
        }
        return restored;
      });
    } else {
      items = [snapshotItem({
        ...(defaultItemFields as unknown as Record<string, unknown>),
        type: (d.type as string) || '',
        fabric: (d.fabric as string) || '',
        color: (d.color as string) || '',
        sku,
        fit: (d.fit as string) || 'regular',
        fitChosen: !!d.fit || !!sku,
        sizes: d.sizes ? { ...(d.sizes as Record<string, number>) } : initSizes(),
        customSizes: d.customSizes ? [...(d.customSizes as unknown[])] : [],
        extras: d.extras ? [...(d.extras as string[])] : [],
        labels: d.labels ? [...(d.labels as string[])] : [],
        zones: d.zones ? ((d.zones as string[]).filter((z: string) => !sku || !sku.zones || sku.zones.includes(z))) : [],
        tech: (d.tech as string) || 'screen',
        textileColor: (d.textileColor as string) || 'white',
        zoneTechs: d.zoneTechs ? { ...(d.zoneTechs as Record<string, string>) } : {},
        zonePrints: d.zonePrints ? JSON.parse(JSON.stringify(d.zonePrints)) : {},
        flexZones: d.flexZones ? JSON.parse(JSON.stringify(d.flexZones)) : {},
        dtgZones: d.dtgZones ? JSON.parse(JSON.stringify(d.dtgZones)) : {},
        embZones: d.embZones ? JSON.parse(JSON.stringify(d.embZones)) : {},
        dtfZones: d.dtfZones ? JSON.parse(JSON.stringify(d.dtfZones)) : {},
        zoneArtworks: d.zoneArtworks ? { ...(d.zoneArtworks as Record<string, string>) } : {},
        designNotes: (d.designNotes as string) || '',
        sizeComment: (d.sizeComment as string) || '',
        noPrint: ((d.zones as string[]) || []).length === 0,
        labelConfig: d.labelConfig || defaultItemFields.labelConfig,
      })];
    }

    const firstItem = items[0] || {};

    set({
      step: 4,
      maxStep: 4,
      _editingOrderId: order.id,
      _editingOrderNumber: order.order_number,
      _lastSavedOrderNum: null,
      items,
      activeItemIdx: 0,
      ...restoreItem(firstItem),
      name: (d.name as string) || '',
      contact: (d.contact as string) || '',
      email: (d.email as string) || '',
      phone: (d.phone as string) || '',
      bitrixDeal: (d.bitrixDeal as string) || order.bitrix_deal || '',
      deadline: (d.deadline as string) || '',
      address: (d.address as string) || '',
      notes: (d.notes as string) || '',
      packOption: (d.packOption as boolean) || false,
      packType: (d.packType as string) || ((d.packOption as boolean) ? 'bopp' : 'none'),
      urgentOption: (d.urgentOption as boolean) || false,
    });
  },

  restoreFromDraft: (data: Record<string, unknown>) => set((_s: Record<string, unknown>) => ({
    ...data,
    maxStep: (data.step as number) || 0,
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
