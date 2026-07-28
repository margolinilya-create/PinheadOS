import { describe, it, expect } from 'vitest';
import {
  DEPARTMENTS,
  DEPT_ICONS,
  DEPT_SHORT_NAMES,
  QUEUE_DEPT_CODES,
  getDepartmentByCode,
} from './departments';

describe('DEPARTMENTS seed', () => {
  it('содержит 12 цехов', () => {
    expect(DEPARTMENTS).toHaveLength(12);
  });

  it('у каждого цеха есть короткое имя и иконка', () => {
    // сид разошёлся со словарями UI → чип покажет код вместо названия
    for (const d of DEPARTMENTS) {
      expect(DEPT_SHORT_NAMES[d.code], `нет короткого имени: ${d.code}`).toBeTruthy();
      expect(DEPT_ICONS[d.code], `нет иконки: ${d.code}`).toBeTruthy();
    }
  });

  it('ОТК заведён производственным участком с очередью', () => {
    expect(getDepartmentByCode('qc')?.name).toBe('ОТК');
    expect(QUEUE_DEPT_CODES.has('qc')).toBe(true);
  });

  it('коды уникальны', () => {
    const codes = DEPARTMENTS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('отмечает три цеха брендирования', () => {
    const branding = DEPARTMENTS.filter((d) => d.is_branding).map((d) => d.code);
    expect(branding).toEqual(['silkscreen', 'dtf', 'embroidery']);
  });

  it('getDepartmentByCode находит по коду', () => {
    expect(getDepartmentByCode('sewing')?.name).toBe('Швейный цех');
    expect(getDepartmentByCode('missing')).toBeUndefined();
  });
});
