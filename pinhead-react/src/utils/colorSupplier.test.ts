import { describe, it, expect } from 'vitest';
import { colorSupplierOf, colorSupplierOfFabric } from './colorSupplier';
import { FABRICS_CATALOG_DEFAULT } from '../data/fabricsCatalog';
import type { Fabric } from '../types/catalog';

const FABRICS = FABRICS_CATALOG_DEFAULT as unknown as Fabric[];

describe('палитра цветов по поставщику ткани', () => {
  it('Медас → medastex, остальные → cottonprom', () => {
    expect(colorSupplierOf('Медас')).toBe('medastex');
    expect(colorSupplierOf('ТД Коттон')).toBe('cottonprom');
    expect(colorSupplierOf('ТониТекс')).toBe('cottonprom');
  });

  it('по коду ткани из каталога', () => {
    expect(colorSupplierOfFabric('medas-kulirnaya-100-180', FABRICS)).toBe('medastex');
    expect(colorSupplierOfFabric('cotton-kulirnaya-100-180', FABRICS)).toBe('cottonprom');
  });

  it('ткани нет в каталоге или у неё нет поставщика → null (палитру не трогать)', () => {
    expect(colorSupplierOfFabric('нет-такой', FABRICS)).toBeNull();
    expect(colorSupplierOfFabric('', FABRICS)).toBeNull();
    expect(colorSupplierOfFabric('x', [{ code: 'x' } as unknown as Fabric])).toBeNull();
  });
});
