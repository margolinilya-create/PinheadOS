/**
 * Маркеры готовности вкладок рабочего места (веха 8, задача 5) — чистая часть:
 * что показать (`tabState`) и как показать активную вкладку в прокручиваемом
 * ряду (`revealTab`). Разметка — `TabMarker.jsx`.
 */
import { gridQty } from '../model/factory';
import { unplacedCount } from '../design/model/layoutMark';
import type { SalesOrder } from '../model/types';

export type TabMarkState = { ready: true } | { text: string; count?: number } | null;

/** Изделия готовы: есть хотя бы одно, у каждого модель и тираж */
const itemsReady = (order: SalesOrder): boolean => order.items.length > 0
  && order.items.every((it) => it.product_type.trim() && gridQty(it.size_grid) > 0);
const clientReady = (order: SalesOrder): boolean => order.customer.trim() !== '';

/**
 * Состояние маркера: `null` — без маркера, `{ ready: true }` — готово,
 * `{ text, count? }` — что не так (число — для бейджа «Дизайна»)
 */
export function tabState(key: string, order: SalesOrder): TabMarkState {
  if (key === 'item') return itemsReady(order) ? { ready: true } : { text: 'не заполнено' };
  if (key === 'client') return clientReady(order) ? { ready: true } : { text: 'не заполнено' };
  if (key === 'design') {
    const prints = order.items.reduce((n: number, it) => n + it.prints.length, 0);
    if (prints === 0) return null;
    const free = unplacedCount(order.items);
    return free > 0 ? { text: `не размещено: ${free}`, count: free } : { ready: true };
  }
  return null;
}

/**
 * Показать активную вкладку в прокручиваемом ряду (≤ 480 px) — только по
 * горизонтали. `scrollIntoView` сдвинул бы и страницу по вертикали, когда
 * вкладку меняет кнопка «Далее» внизу панели.
 */
export function revealTab(el: HTMLElement | null | undefined): void {
  const row = el?.parentElement;
  if (!el || !row || row.scrollWidth <= row.clientWidth) return;
  const box = el.getBoundingClientRect();
  const view = row.getBoundingClientRect();
  if (box.left < view.left) row.scrollLeft -= view.left - box.left;
  else if (box.right > view.right) row.scrollLeft += box.right - view.right;
}
