import { describe, it, expect } from 'vitest';
import { daysLeft, formatTimeIn, isUrgent, isOverdue } from './time';

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

describe('isUrgent / isOverdue — фильтры сроков (дашборд ↔ чипы заказов)', () => {
  const now = new Date('2026-07-17T15:30:00');

  it('isUrgent: 0–3 дня включительно', () => {
    expect(isUrgent('2026-07-17', now)).toBe(true);  // сегодня (0)
    expect(isUrgent('2026-07-20', now)).toBe(true);  // ровно 3 дня
    expect(isUrgent('2026-07-21', now)).toBe(false); // 4 дня — не горит
  });

  it('isUrgent: просроченный и пустой срок не считаются горящими', () => {
    expect(isUrgent('2026-07-15', now)).toBe(false);
    expect(isUrgent(null, now)).toBe(false);
    expect(isUrgent(undefined, now)).toBe(false);
  });

  it('isOverdue: только даты в прошлом', () => {
    expect(isOverdue('2026-07-16', now)).toBe(true);
    expect(isOverdue('2026-07-17', now)).toBe(false); // сегодня — ещё не просрочен
    expect(isOverdue('2026-07-18', now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });

  it('urgent и overdue взаимоисключающие — счётчики дашборда не пересекаются', () => {
    for (const d of ['2026-07-10', '2026-07-17', '2026-07-19', '2026-08-01']) {
      expect(isUrgent(d, now) && isOverdue(d, now)).toBe(false);
    }
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
