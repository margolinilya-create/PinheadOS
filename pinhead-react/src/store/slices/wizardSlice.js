// Wizard navigation slice: step, maxStep, goToStep, nextStep, prevStep
import { snapshotItem, restoreItem } from './helpers';

export const wizardSlice = (set, _get) => ({
  step: 0,
  maxStep: 0,

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
});
