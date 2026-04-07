// Items slice: items, activeItemIdx, saveCurrentItem, addNewItem, editItem, removeItem
import { snapshotItem, restoreItem, defaultItemFields } from './helpers';

export const itemsSlice = (set, _get) => ({
  items: [],
  activeItemIdx: -1,

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
    return { ...restoreItem(s.items[idx]), activeItemIdx: idx, step: 1, maxStep: Math.max(s.maxStep, 3) };
  }),
  removeItem: (idx) => set(s => {
    const items = s.items.filter((_, i) => i !== idx);
    const activeItemIdx = s.activeItemIdx === idx ? -1 : s.activeItemIdx > idx ? s.activeItemIdx - 1 : s.activeItemIdx;
    return { items, activeItemIdx };
  }),
});
