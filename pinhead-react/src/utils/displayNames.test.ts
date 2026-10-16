import { describe, it, expect } from 'vitest';
import { fabricDisplayName, fmtPerUnit, packName } from './displayNames';

describe('fabricDisplayName', () => {
  it('название и плотность из каталога, а не код', () => {
    const cat = [{ code: 'medas-kulirnaya-100-160', name: 'Кулирка 100% хлопок', density: 160 }];
    expect(fabricDisplayName('medas-kulirnaya-100-160', cat)).toBe('Кулирка 100% хлопок, 160 г/м²');
  });
  it('нет в каталоге — код как есть; пусто — пусто', () => {
    expect(fabricDisplayName('nope-code', [])).toBe('nope-code');
    expect(fabricDisplayName('', [])).toBe('');
  });
});

describe('fmtPerUnit', () => {
  it('целые рубли с разрядами', () => {
    expect(fmtPerUnit(1122.6).replace(/\s/g, ' ')).toBe('+1 123 ₽/шт');
    expect(fmtPerUnit(291.6)).toBe('+292 ₽/шт');
  });
});

describe('packName', () => {
  it('подпись вида из прайса; неизвестный — пусто', () => {
    expect(packName('zip')).toBe('ЗИП пакет');
    expect(packName('bopp')).toBe('БОПП пакет');
    expect(packName('x')).toBe('');
  });
});
