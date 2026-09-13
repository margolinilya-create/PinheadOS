import { create } from 'zustand';

/**
 * Поиск на экране «Заказы» (title / № сделки / менеджер).
 *
 * СТРОКИ В ШАПКЕ БОЛЬШЕ НЕТ (правка 13.09, п. 1): поле висело на каждом
 * экране раздела, а фильтровало ровно один — по Enter оно уводило
 * на `/orders`. Стор остался у самого экрана: он держит строку между
 * переходами (возврат из карточки заказа не теряет набранное), а
 * URL-синхронизацию сюда не тащим — она уже есть у остальных фильтров списка.
 */
interface ErpSearchState {
  query: string;
  setQuery: (q: string) => void;
}

export const useErpSearch = create<ErpSearchState>((set) => ({
  query: '',
  setQuery: (q) => set({ query: q }),
}));
