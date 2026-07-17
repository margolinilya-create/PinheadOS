import { describe, it, expect } from 'vitest';
import { daysLeft, formatTimeIn } from './time';

describe('daysLeft — дней до срока клиента (единый хелпер экранов)', () => {
  const now = new Date('2026-07-17T15:30:00');

  it('null/пусто → null', () => {
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft(undefined, now)).toBeNull();
    expect(daysLeft('', now)).toBeNull();
  });

  it('сегодня → 0, будущее → положительное', () => {
    expect(daysLeft('2026-07-17', now)).toBe(0);
    expect(daysLeft('2026-07-20', now)).toBe(3);
  });

  it('просроченный срок → отрицательное', () => {
    expect(daysLeft('2026-07-15', now)).toBe(-2);
  });
});

describe('formatTimeIn — «время в этапе» (механика kontora24)', () => {
  const now = new Date('2026-07-17T12:00:00Z').getTime();

  it('минуты до часа', () => {
    expect(formatTimeIn('2026-07-17T11:45:00Z', now)).toBe('15 мин');
  });

  it('часы до суток', () => {
    expect(formatTimeIn('2026-07-17T07:00:00Z', now)).toBe('5 ч');
  });

  it('дни от суток', () => {
    expect(formatTimeIn('2026-07-14T12:00:00Z', now)).toBe('3 дн');
  });

  it('null → пустая строка', () => {
    expect(formatTimeIn(null, now)).toBe('');
  });

  it('меньше минуты → «только что»', () => {
    expect(formatTimeIn('2026-07-17T11:59:40Z', now)).toBe('только что');
  });
});
