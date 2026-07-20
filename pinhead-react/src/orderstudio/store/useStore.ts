// ═══════════════════════════════════════════
// Zustand store — глобальное состояние заказа
// Combines domain slices into a single store
// ═══════════════════════════════════════════
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
// Combined store state is loosely typed below; tight types live in individual slice domains.
import {
  wizardSlice,
  productSlice,
  designSlice,
  itemsSlice,
  detailsSlice,
  catalogSlice,
  orderSlice,
} from './slices';
import { defaultItemFields } from './slices/helpers';

// Loose state type — matches the JS slice contract without enumerating 150+ fields.
// Future work: migrate individual slices and tighten this to a union.
export type StoreState = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlicePart = (...a: any[]) => Record<string, unknown>;

export const useStore = create<StoreState>()(
  subscribeWithSelector((...a) => ({
    // Current item fields (initial state)
    ...defaultItemFields,

    // Combine all slices
    ...(wizardSlice as SlicePart)(...a),
    ...(productSlice as SlicePart)(...a),
    ...(designSlice as SlicePart)(...a),
    ...(itemsSlice as SlicePart)(...a),
    ...(detailsSlice as SlicePart)(...a),
    ...(catalogSlice as SlicePart)(...a),
    ...(orderSlice as SlicePart)(...a),
  }))
);

// Re-export helpers for backward compatibility
export { ITEM_FIELDS, snapshotItem, restoreItem, defaultItemFields } from './slices/helpers';
