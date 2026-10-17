/**
 * Палитра цветов визарда по поставщику ткани.
 *
 * Палитр две: Медастекс (ткани «Медас») и Коттонпром (все остальные).
 * Раньше правило жило внутри `FabricGrid` — теперь его же зовёт буфер позиции
 * рабочего места (`orderstudio/workplace/itemBuffer.ts`), когда кладёт позицию
 * в стор визарда: палитра обязана совпасть с той, что выставил бы выбор ткани.
 */
import type { Fabric } from '../types/catalog';

export type ColorSupplier = 'medastex' | 'cottonprom';

/** Поставщик ткани → палитра (раньше «медас» сравнивался с «medastex» и не совпадал никогда) */
export function colorSupplierOf(supplier: string): ColorSupplier {
  return supplier === 'Медас' ? 'medastex' : 'cottonprom';
}

/** Палитра по коду ткани; ткани нет в каталоге или у неё нет поставщика — `null` (палитру не трогать) */
export function colorSupplierOfFabric(code: string, fabrics: readonly Fabric[]): ColorSupplier | null {
  if (!code) return null;
  const supplier = fabrics.find((f) => f.code === code)?.supplier;
  return supplier ? colorSupplierOf(supplier) : null;
}
