import { describe, it, expect } from 'vitest';
import { formatTimeIn } from './time';

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
