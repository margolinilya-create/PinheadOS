/**
 * Упаковка позиции (вынесено из `pricing/priceOrder.ts` в вехе 6+7, задача 2):
 * её читают цена и ТЗ, а модель ТЗ не импортирует `pricing/` (сторож
 * `tz/model/tzModelGuards.test.ts`). `priceOrder` реэкспортирует её.
 */
import type { SalesItem } from './types';

/** Упаковка позиции: своя или заказа (`inherit`/пусто) */
export function itemPackaging(item: Pick<SalesItem, 'packaging'>, orderPackaging: string): string {
  return !item.packaging || item.packaging === 'inherit' ? (orderPackaging || 'none') : item.packaging;
}
