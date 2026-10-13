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

/**
 * Тип стора: поля свободные, ДЕЙСТВИЯ типизированы.
 *
 * Раньше здесь стоял голый `Record<string, unknown>` с пометкой «future work:
 * перечислить 150+ полей». Перечислять их и правда незачем — часть приезжает
 * из JSON каталогов, — но заодно необъявленными оказывались и все ВЫЗОВЫ:
 * `useStore.getState().selectSku(...)` был `{}` и «не вызываем» с точки зрения
 * tsc, из-за чего только в одном тесте набиралось 15 ошибок, а в коде
 * опечатка в имени действия не ловилась вообще.
 *
 * Формы слайсов выводятся из них самих через `ReturnType` — без ручного
 * дублирования, которое разошлось бы с первой же правкой слайса.
 */
type Slices =
  & ReturnType<typeof wizardSlice>
  & ReturnType<typeof productSlice>
  & ReturnType<typeof designSlice>
  & ReturnType<typeof itemsSlice>
  & ReturnType<typeof detailsSlice>
  & ReturnType<typeof catalogSlice>
  & ReturnType<typeof orderSlice>;

export type StoreState = Record<string, unknown> & Slices;

/**
 * Слайсы принимают `set`/`get` в форме `Record<string, unknown>`, а zustand
 * зовёт их со своей парой — приведение остаётся. Оно точечное и объяснимое:
 * тип РЕЗУЛЬТАТА (`Slices`) при этом выводится по-настоящему, поэтому
 * действия стора проверяются.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlicePart<T> = (...a: any[]) => T;
const part = <T,>(slice: (set: never, get: never) => T) => slice as unknown as SlicePart<T>;

export const useStore = create<StoreState>()(
  subscribeWithSelector((...a) => ({
    // Current item fields (initial state)
    ...defaultItemFields,

    // Combine all slices
    ...part(wizardSlice)(...a),
    ...part(productSlice)(...a),
    ...part(designSlice)(...a),
    ...part(itemsSlice)(...a),
    ...part(detailsSlice)(...a),
    ...part(catalogSlice)(...a),
    ...part(orderSlice)(...a),
  }))
);

// Re-export helpers for backward compatibility
export { ITEM_FIELDS, snapshotItem, restoreItem, defaultItemFields } from './slices/helpers';
