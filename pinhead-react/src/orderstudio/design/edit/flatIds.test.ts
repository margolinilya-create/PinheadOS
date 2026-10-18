import { describe, it, expect } from 'vitest';
import { idError, slugOf, suggestFlatId } from './flatIds';

describe('id флэта', () => {
  it('idError: пусто, форма, занят (в том числе снятым и битым)', () => {
    const reserved = new Set(['tshirt-regular']);
    expect(idError('', reserved)).toMatch(/Укажите/);
    expect(idError('Tshirt X', reserved)).toMatch(/латиница/);
    expect(idError('-tshirt', reserved)).toMatch(/латиница/);
    expect(idError('a'.repeat(64), reserved)).toMatch(/латиница/);
    expect(idError('tshirt_x', reserved)).toMatch(/латиница/);
    expect(idError('tshirt-regular', reserved)).toMatch(/занят/);
    expect(idError('polo-klassika', reserved)).toBeNull();
  });

  it('suggestFlatId: транслитерация имени, занятый — суффикс', () => {
    expect(suggestFlatId('Поло классика', new Set())).toBe('polo-klassika');
    expect(suggestFlatId('Поло классика', new Set(['polo-klassika']))).toBe('polo-klassika-2');
    expect(suggestFlatId('Поло классика', new Set(['polo-klassika', 'polo-klassika-2']))).toBe('polo-klassika-3');
    expect(suggestFlatId('Худи «Оверсайз» №2', new Set())).toBe('khudi-oversayz-2');
    expect(suggestFlatId('???', new Set())).toBe('flat');
    expect(suggestFlatId('Щ'.repeat(40), new Set()).length).toBeLessThanOrEqual(63);
    expect(slugOf('Футболка Regular')).toBe('futbolka-regular');
  });
});
