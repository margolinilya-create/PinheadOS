import type { MouseEvent } from 'react';
import { create } from 'zustand';

/**
 * Крошечный стор боковой карточки заказа (редизайн): любой экран (канбан/таблица/очередь)
 * открывает детали заказа в правом Drawer по id, не уходя с текущего экрана.
 */
interface OrderDrawerState {
  orderId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useOrderDrawer = create<OrderDrawerState>((set) => ({
  orderId: null,
  open: (id) => set({ orderId: id }),
  close: () => set({ orderId: null }),
}));

/**
 * Обработчик клика по ссылке заказа: обычный ЛКМ открывает боковой Drawer, а Ctrl/Cmd/Shift-клик
 * (и средняя кнопка → auxclick) сохраняют стандартный переход по href — диплинк/новая вкладка.
 */
export function orderLinkClick(
  id: string,
  e: React.MouseEvent<HTMLAnchorElement>,
): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  useOrderDrawer.getState().open(id);
}
