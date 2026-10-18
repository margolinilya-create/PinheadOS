import { describe, it, expect } from 'vitest';
import { METHOD_LABELS } from '../../model/printMethods';
import { SALES_PRINT_METHODS } from '../../model/types';
import { METHOD_TZ_COLUMN, TZ_COLUMNS, tzColumnOf } from './tzColumns';

describe('tzColumnOf — столбец матрицы ТЗ', () => {
  it('у каждой техники METHOD_LABELS есть столбец из перечня', () => {
    expect(Object.keys(METHOD_TZ_COLUMN).sort()).toEqual(Object.keys(METHOD_LABELS).sort());
    for (const m of SALES_PRINT_METHODS) expect(TZ_COLUMNS).toContain(METHOD_TZ_COLUMN[m]);
  });

  it('техники по столбцам', () => {
    expect(tzColumnOf('silkscreen', '')).toBe('Ш');
    expect(tzColumnOf('embroidery', '')).toBe('В');
    expect(tzColumnOf('dtf', '')).toBe('Т');
    expect(tzColumnOf('heat_transfer', '')).toBe('Т');
    expect(tzColumnOf('sublimation', '')).toBe('Т');
    expect(tzColumnOf('dtg', null)).toBe('DTG');
    expect(tzColumnOf('patch', undefined)).toBe('П');
    expect(tzColumnOf('other', '')).toBe('П');
  });

  it('подрядчик — П при любой технике, пробелы — не подрядчик', () => {
    expect(tzColumnOf('silkscreen', 'Тиснение-Про')).toBe('П');
    expect(tzColumnOf('embroidery', 'Вышивка-Сервис')).toBe('П');
    expect(tzColumnOf('dtg', '   ')).toBe('DTG');
  });
});
