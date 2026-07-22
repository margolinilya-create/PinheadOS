import { create } from 'zustand';

/**
 * Глобальный поиск ERP (редизайн): строка из шапки и поле поиска на экране «Заказы» — один
 * источник. По Enter в шапке уходим на /orders, где OrdersScreen фильтрует список по этой строке
 * (title / № сделки / менеджер). Держим в отдельном сторе, чтобы не тянуть URL-синхронизацию.
 */
interface ErpSearchState {
  query: string;
  setQuery: (q: string) => void;
}

export const useErpSearch = create<ErpSearchState>((set) => ({
  query: '',
  setQuery: (q) => set({ query: q }),
}));
