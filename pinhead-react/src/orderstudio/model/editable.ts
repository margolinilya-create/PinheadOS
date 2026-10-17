/**
 * Можно ли править заказ v4 (веха 3).
 *
 * Правка открыта только черновику: со статуса `price_review` и дальше заказ
 * ушёл на проверку цены или в работу, и сервер отказывает записи стражем
 * (42501 «Заказ отправлен в работу — правка закрыта»). Интерфейс считает так же,
 * чтобы не копить правки, которые никогда не сохранятся.
 */
import type { SalesOrder } from './types';

export function isEditable(order: Pick<SalesOrder, 'status'> | null | undefined): boolean {
  return order?.status === 'draft';
}
