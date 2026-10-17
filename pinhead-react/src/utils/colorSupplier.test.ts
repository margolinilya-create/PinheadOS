import { describe, it, expect } from 'vitest';
import { colorSupplierOf, colorSupplierOfFabric } from './colorSupplier';
import { FABRICS_CATALOG_DEFAULT } from '../data/fabricsCatalog';
import { SUPPLIERS_SEED } from '../orderstudio/catalog/seeds';
import type { Fabric } from '../types/catalog';
import type { Supplier } from '../orderstudio/catalog/types';

const FABRICS = FABRICS_CATALOG_DEFAULT as unknown as Fabric[];

describe('палитра цветов по поставщику ткани — из справочника', () => {
  it('Медас → medastex, остальные → палитра по умолчанию (cottonprom)', () => {
    expect(colorSupplierOf('Медас', SUPPLIERS_SEED)).toBe('medastex');
    expect(colorSupplierOf('ТД Коттон', SUPPLIERS_SEED)).toBe('cottonprom');
    expect(colorSupplierOf('ТониТекс', SUPPLIERS_SEED)).toBe('cottonprom');
  });

  it('привязка и умолчание — из справочника, а не из кода', () => {
    const list: Supplier[] = SUPPLIERS_SEED.map((s) => ({
      ...s, fabricSupplierNames: s.id === 'cottonprom' ? ['ТониТекс'] : [], isDefault: s.id === 'medastex',
    }));
    expect(colorSupplierOf('ТониТекс', list)).toBe('cottonprom');
    expect(colorSupplierOf('ТД Коттон', list)).toBe('medastex');
  });

  it('по коду ткани из каталога', () => {
    expect(colorSupplierOfFabric('medas-kulirnaya-100-180', FABRICS, SUPPLIERS_SEED)).toBe('medastex');
    expect(colorSupplierOfFabric('cotton-kulirnaya-100-180', FABRICS, SUPPLIERS_SEED)).toBe('cottonprom');
  });

  it('ткани нет в каталоге — пусто; справочник пуст — пусто', () => {
    expect(colorSupplierOfFabric('нет-такой', FABRICS, SUPPLIERS_SEED)).toBe('');
    expect(colorSupplierOfFabric('', FABRICS, SUPPLIERS_SEED)).toBe('');
    expect(colorSupplierOf('Медас', [])).toBe('');
  });
});
