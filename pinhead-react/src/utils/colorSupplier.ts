/**
 * Палитра цветов визарда по поставщику ткани — из справочника
 * «Поставщики и палитры» (`catalog_config.suppliers`, веха 4).
 *
 * Значение — id поставщика (`medastex`, `cottonprom`…) или `''`. Его ставят
 * выбор ткани (`FabricGrid`) и буфер позиции рабочего места
 * (`orderstudio/workplace/itemBuffer.ts`): палитра обязана совпасть с той,
 * что выставил бы выбор ткани. Правило привязки — `supplierForFabric`.
 */
import { supplierForFabric } from '../orderstudio/catalog/suppliers';
import type { Supplier } from '../orderstudio/catalog/types';
import type { Fabric } from '../types/catalog';

/** Имя поставщика ткани → id палитры; справочник пуст — `''` */
export function colorSupplierOf(supplier: string, suppliers: readonly Supplier[]): string {
  return supplierForFabric({ supplier }, suppliers)?.id ?? '';
}

/** Палитра по коду ткани; ткани нет в каталоге — `''` */
export function colorSupplierOfFabric(code: string, fabrics: readonly Fabric[], suppliers: readonly Supplier[]): string {
  if (!code) return '';
  const fabric = fabrics.find((f) => f.code === code);
  return fabric ? (supplierForFabric(fabric, suppliers)?.id ?? '') : '';
}
