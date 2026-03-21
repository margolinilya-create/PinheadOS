// ═══════════════════════════════════════════
// Zustand store — глобальное состояние заказа
// Combines domain slices into a single store
// ═══════════════════════════════════════════
import { create } from 'zustand';
import { wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice } from './slices';
import { defaultItemFields } from './slices/helpers';

export const useStore = create((...a) => ({
  // Current item fields (initial state)
  ...defaultItemFields,

  // Combine all slices
  ...wizardSlice(...a),
  ...productSlice(...a),
  ...designSlice(...a),
  ...itemsSlice(...a),
  ...detailsSlice(...a),
  ...catalogSlice(...a),
  ...orderSlice(...a),
}));

// ─── Persist draft to localStorage ───
useStore.subscribe((state) => {
  if (state.step > 0) {
    localStorage.setItem('pinhead_draft', JSON.stringify({
      step: state.step,
      sku: state.sku,
      fabric: state.fabric,
      color: state.color,
      sizes: state.sizes,
      zones: state.zones,
      extras: state.extras,
      labelConfig: state.labelConfig,
      items: state.items,
      activeItemIdx: state.activeItemIdx,
      customSizes: state.customSizes,
      fit: state.fit,
      fitChosen: state.fitChosen,
      type: state.type,
      tech: state.tech,
      textileColor: state.textileColor,
      zoneTechs: state.zoneTechs,
      zonePrints: state.zonePrints,
      flexZones: state.flexZones,
      dtgZones: state.dtgZones,
      embZones: state.embZones,
      dtfZones: state.dtfZones,
      zoneArtworks: state.zoneArtworks,
      designNotes: state.designNotes,
      sizeComment: state.sizeComment,
      noPrint: state.noPrint,
      name: state.name,
      contact: state.contact,
      email: state.email,
      phone: state.phone,
      deadline: state.deadline,
      address: state.address,
      notes: state.notes,
      packOption: state.packOption,
      urgentOption: state.urgentOption,
      bitrixDeal: state.bitrixDeal,
    }));
  }
});

// Re-export helpers for backward compatibility
export { ITEM_FIELDS, snapshotItem, restoreItem, defaultItemFields } from './slices/helpers';
