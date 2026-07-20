// Items slice: items, activeItemIdx, saveCurrentItem, addNewItem, editItem, removeItem
import { snapshotItem, restoreItem, defaultItemFields } from './helpers';

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const itemsSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  items: [] as Record<string, unknown>[],
  activeItemIdx: -1,

  saveCurrentItem: () => set((s: Record<string, unknown>) => {
    const snap = snapshotItem(s);
    const items = [...(s.items as Record<string, unknown>[])];
    const activeItemIdx = s.activeItemIdx as number;
    if (activeItemIdx >= 0 && activeItemIdx < items.length) {
      items[activeItemIdx] = snap;
    } else {
      items.push(snap);
    }
    return { items, activeItemIdx: items.length - 1 };
  }),
  addNewItem: () => set((s: Record<string, unknown>) => {
    return { ...restoreItem(defaultItemFields as unknown as Record<string, unknown>), activeItemIdx: -1, step: 0, maxStep: Math.max(s.maxStep as number, 3) };
  }),
  editItem: (idx: number) => set((s: Record<string, unknown>) => {
    const items = s.items as Record<string, unknown>[];
    if (idx < 0 || idx >= items.length) return {};
    return { ...restoreItem(items[idx]), activeItemIdx: idx, step: 1, maxStep: Math.max(s.maxStep as number, 3) };
  }),
  removeItem: (idx: number) => set((s: Record<string, unknown>) => {
    const items = (s.items as Record<string, unknown>[]).filter((_: unknown, i: number) => i !== idx);
    const currentIdx = s.activeItemIdx as number;
    const activeItemIdx = currentIdx === idx ? -1 : currentIdx > idx ? currentIdx - 1 : currentIdx;
    return { items, activeItemIdx };
  }),
});
