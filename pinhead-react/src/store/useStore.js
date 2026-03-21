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


// Re-export helpers for backward compatibility
export { ITEM_FIELDS, snapshotItem, restoreItem, defaultItemFields } from './slices/helpers';
