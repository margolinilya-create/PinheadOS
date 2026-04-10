// Wizard navigation slice: step, maxStep, goToStep, nextStep, prevStep
import { snapshotItem, restoreItem } from './helpers';

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const wizardSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  step: 0,
  maxStep: 0,

  goToStep: (n: number) => set((s: Record<string, unknown>) => {
    if (n > (s.maxStep as number)) return {};
    return { step: n };
  }),
  nextStep: () => set((s: Record<string, unknown>) => {
    // При переходе со step 1 (Дизайн) → 2 (Позиции) автосохраняем текущую позицию
    if (s.step === 1) {
      const snap = snapshotItem(s);
      const items = [...(s.items as Record<string, unknown>[])];
      const activeItemIdx = s.activeItemIdx as number;
      if (activeItemIdx >= 0 && activeItemIdx < items.length) {
        items[activeItemIdx] = snap;
      } else {
        items.push(snap);
      }
      const next = 2;
      return { step: next, maxStep: Math.max(s.maxStep as number, next), items, activeItemIdx: items.length - 1 };
    }
    const next = Math.min((s.step as number) + 1, 4);
    return { step: next, maxStep: Math.max(s.maxStep as number, next) };
  }),
  prevStep: () => set((s: Record<string, unknown>) => {
    // При переходе со step 2 (Позиции) → 1 (Дизайн) загружаем последнюю позицию
    const items = s.items as Record<string, unknown>[];
    if (s.step === 2 && items.length > 0) {
      const activeItemIdx = s.activeItemIdx as number;
      const idx = activeItemIdx >= 0 ? activeItemIdx : items.length - 1;
      return { step: 1, ...restoreItem(items[idx]), activeItemIdx: idx };
    }
    return { step: Math.max((s.step as number) - 1, 0) };
  }),
});
