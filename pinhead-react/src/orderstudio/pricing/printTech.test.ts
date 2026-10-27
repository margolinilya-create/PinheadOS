import { describe, it, expect } from 'vitest';
import { printTechText } from './printTech';

describe('printTechText — строка техники под ценой нанесения (веха 5в, Э1)', () => {
  it('шелкография и флекс — формат сетки; Max — с пояснением', () => {
    expect(printTechText({ kind: 'screen', fmt: 'A4' })).toBe('Шелкография: формат A4');
    expect(printTechText({ kind: 'screen', fmt: 'Max' })).toBe('Шелкография: формат Max — больше A3+');
    expect(printTechText({ kind: 'flex', fmt: 'A5' })).toBe('Флекс: формат A5');
  });
  it('DTF — раскладка на плёнке', () => {
    expect(printTechText({ kind: 'dtf', perMeter: 42, cols: 6 })).toBe('Плёнка: 1 м на 42 шт (6 в ряд)');
  });
  it('вышивка — стежки с разделителем разрядов и склонением', () => {
    expect(printTechText({ kind: 'emb', stitches: 8600 })).toBe('Вышивка: ≈ 8 600 стежков');
    expect(printTechText({ kind: 'emb', stitches: 1001 })).toBe('Вышивка: ≈ 1 001 стежок');
    expect(printTechText({ kind: 'emb', stitches: 902 })).toBe('Вышивка: ≈ 902 стежка');
  });
  it('DTG — размер печати; 40x45 — в сантиметрах', () => {
    expect(printTechText({ kind: 'dtg', size: 'A4' })).toBe('DTG: формат A4');
    expect(printTechText({ kind: 'dtg', size: '40x45' })).toBe('DTG: формат 40 × 45 см');
  });
});
