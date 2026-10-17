import { describe, it, expect } from 'vitest';
import { PACKAGING_OPTIONS, packagingOptions } from './labels';

describe('packagingOptions — подписи упаковки из справочника (веха 4)', () => {
  it('нет справочника — подписи кода, 4 вида CHECK ERP по порядку', () => {
    expect(packagingOptions(undefined)).toEqual(PACKAGING_OPTIONS);
    expect(packagingOptions(null)).toEqual(PACKAGING_OPTIONS);
    expect(packagingOptions({})).toEqual(PACKAGING_OPTIONS);
  });

  it('подпись — из справочника; порядок и набор ключей — прежние', () => {
    const opts = packagingOptions([
      { key: 'zip', name: 'ЗИП-лок с бегунком', price: 45 },
      { key: 'none', name: 'Без пакета', price: 0 },
    ]);
    expect(opts.map((o) => o.key)).toEqual(['none', 'bopp', 'zip', 'other']);
    expect(opts.find((o) => o.key === 'zip')?.label).toBe('ЗИП-лок с бегунком');
    expect(opts.find((o) => o.key === 'none')?.label).toBe('Без пакета');
    expect(opts.find((o) => o.key === 'bopp')?.label).toBe('БОПП пакет');
  });

  it('пустая подпись и чужой ключ не попадают в список', () => {
    const opts = packagingOptions([
      { key: 'bopp', name: '   ', price: 20 },
      { key: 'box', name: 'Коробка', price: 100 },
    ]);
    expect(opts.find((o) => o.key === 'bopp')?.label).toBe('БОПП пакет');
    expect(opts.some((o) => o.key === 'box')).toBe(false);
  });
});
