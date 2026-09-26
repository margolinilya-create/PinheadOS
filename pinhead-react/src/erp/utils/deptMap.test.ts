// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deptById, deptNameById } from './deptMap';

/**
 * Карта на массив — одна и та же ссылка, пока тот же массив; новый массив —
 * новая карта. Мутация (проверена 26.09): убрать `WeakMap` и строить карту
 * каждый вызов — первый тест красный.
 */
describe('deptMap — карты участков с кэшем по массиву', () => {
  const depts = [
    { id: 'd1', name: 'Закрой', code: 'cutting' },
    { id: 'd2', name: 'Пошив', code: 'sewing' },
  ];

  it('тот же массив → та же карта', () => {
    expect(deptById(depts)).toBe(deptById(depts));
    expect(deptNameById(depts)).toBe(deptNameById(depts));
  });

  it('карта отвечает по id', () => {
    expect(deptById(depts).get('d2')?.code).toBe('sewing');
    expect(deptNameById(depts).get('d1')).toBe('Закрой');
    expect(deptById(depts).get('nope')).toBeUndefined();
  });

  it('другой массив с тем же содержимым → другая карта (ключ — ссылка)', () => {
    const copy = [...depts];
    expect(deptById(copy)).not.toBe(deptById(depts));
    expect(deptById(copy).get('d1')).toBe(depts[0]);
  });

  it('пустой массив — пустая карта, без падений', () => {
    expect(deptById([]).size).toBe(0);
  });
});
