import { describe, it, expect } from 'vitest';
import { DEPARTMENTS, getDepartmentByCode } from './departments';

describe('DEPARTMENTS seed', () => {
  it('содержит 11 цехов', () => {
    expect(DEPARTMENTS).toHaveLength(11);
  });

  it('коды уникальны', () => {
    const codes = DEPARTMENTS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('отмечает три цеха брендирования', () => {
    const branding = DEPARTMENTS.filter((d) => d.branding).map((d) => d.code);
    expect(branding).toEqual(['silkscreen', 'dtf', 'embroidery']);
  });

  it('getDepartmentByCode находит по коду', () => {
    expect(getDepartmentByCode('sewing')?.name).toBe('Швейный цех');
    expect(getDepartmentByCode('missing')).toBeUndefined();
  });
});
