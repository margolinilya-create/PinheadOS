/**
 * Реестр вкладок «Справочников заказа» (веха 4, задача 2) — ФИКСИРОВАН здесь:
 * id в адресе (`?tab=`) и подписи. Панели вкладок сопоставляет `OrderSettings`;
 * задачи 3–5 меняют только файлы вкладок (`tabs/*Tab.jsx`). Веха 5а, задача 4:
 * «Флэты и зоны» (`?tab=flats`) — силуэты изделий для вкладки «Дизайн».
 */
export const ORDER_SETTINGS_TABS = [
  { id: 'suppliers', label: 'Поставщики и палитры' },
  { id: 'labels', label: 'Бирки и схемы' },
  { id: 'packaging', label: 'Упаковка' },
  { id: 'pricing', label: 'Правила цены' },
  { id: 'tz', label: 'Подвал ТЗ' },
  { id: 'flats', label: 'Флэты и зоны' },
] as const;

export type OrderSettingsTab = (typeof ORDER_SETTINGS_TABS)[number]['id'];

const DEFAULT_TAB: OrderSettingsTab = 'suppliers';

/** Вкладка из адреса (`?tab=`); неизвестная или пустая — первая */
export function tabFromSearch(value: string | null | undefined): OrderSettingsTab {
  const hit = ORDER_SETTINGS_TABS.find((t) => t.id === value);
  return hit ? hit.id : DEFAULT_TAB;
}
