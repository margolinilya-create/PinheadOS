import type { MouseEvent } from 'react';
import { create } from 'zustand';

/** Имя параметра адреса, в котором живёт открытая боковая карточка */
export const ORDER_DRAWER_PARAM = 'order';

type DrawerNavigate = (id: string | null) => void;

/**
 * Боковая карточка заказа: любой экран (канбан/таблица/очередь) открывает детали
 * заказа в правом Drawer, не уходя с текущего экрана.
 *
 * Состояние ведётся в адресе (`?order=<id>`), а не только в памяти: иначе
 * перезагрузка теряла открытую карточку, ссылку «список + открытая карточка»
 * нельзя было переслать, а кнопка «Назад» — главный жест на планшетах —
 * уводила с экрана вместо того, чтобы закрыть панель.
 *
 * Сам стор про роутер не знает: функцию перехода регистрирует `OrderDrawerHost`,
 * который смонтирован внутри роутера. Пока навигатор не зарегистрирован (юнит-тесты,
 * рендер без роутера) `open`/`close` работают по памяти — стор остаётся
 * самостоятельным и тестируемым.
 */
interface OrderDrawerState {
  orderId: string | null;
  /** Регистрируется хостом; пишет состояние карточки в адрес */
  navigate: DrawerNavigate | null;
  open: (id: string) => void;
  close: () => void;
  /** Хост зеркалит сюда значение `?order=` из адреса */
  syncFromUrl: (id: string | null) => void;
}

export const useOrderDrawer = create<OrderDrawerState>((set, get) => ({
  orderId: null,
  navigate: null,
  open: (id) => {
    const { navigate } = get();
    if (navigate) navigate(id);
    else set({ orderId: id });
  },
  close: () => {
    const { navigate } = get();
    if (navigate) navigate(null);
    else set({ orderId: null });
  },
  syncFromUrl: (id) => {
    if (get().orderId !== id) set({ orderId: id });
  },
}));

/**
 * Обработчик клика по ссылке заказа: обычный ЛКМ открывает боковой Drawer, а Ctrl/Cmd/Shift-клик
 * (и средняя кнопка → auxclick) сохраняют стандартный переход по href — диплинк/новая вкладка.
 */
export function orderLinkClick(
  id: string,
  e: MouseEvent<HTMLAnchorElement>,
): void {
  // Ctrl/Cmd/Shift-клик — отдаём браузеру (новая вкладка / диплинк), но гасим всплытие,
  // чтобы клик по заголовку внутри строки заказа не тогглил её разворот заодно.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  useOrderDrawer.getState().open(id);
}
