import { describe, it, expect } from 'vitest';
import { sanitizeHex } from './sanitizeHex';

describe('sanitizeHex — цвет в стиль только проверенным', () => {
  it('#RGB и #RRGGBB проходят', () => {
    expect(sanitizeHex('#fff')).toBe('#fff');
    expect(sanitizeHex('#A1B2C3')).toBe('#A1B2C3');
  });

  it('вставка разметки и мусор — запасной #ccc', () => {
    expect(sanitizeHex('#fff" onload=alert(1)')).toBe('#ccc');
    expect(sanitizeHex('red')).toBe('#ccc');
    expect(sanitizeHex(undefined)).toBe('#ccc');
    expect(sanitizeHex(42)).toBe('#ccc');
  });
});
