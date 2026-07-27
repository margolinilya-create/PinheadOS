import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from './useErpStore';

/**
 * Активные значения справочника по виду (правка 12) — подсказки в рабочих экранах.
 * Отключённые значения не предлагаются, но остаются в уже сохранённых заказах.
 *
 * useShallow сравнивает поэлементно, поэтому новый массив на каждый рендер
 * не вызывает лишних ререндеров.
 */
export function useDictionary(kind) {
  return useErpStore(
    useShallow((s) => s.dictionaries
      .filter((d) => d.kind === kind && d.active)
      .sort((a, b) => a.sort_order - b.sort_order)),
  );
}
