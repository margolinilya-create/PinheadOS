import { describe, it, expect, afterEach } from 'vitest';
import { fabricDisplayName, fmtPerUnit, packName } from './displayNames';
import { useStore } from '../store/useStore';
import { PRICES } from '../data/prices';

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

  describe('подпись — из прайса стора (справочник упаковки, веха 4)', () => {
    afterEach(() => useStore.setState({ prices: PRICES }));

    it('переименованный в админке вид — новая подпись', () => {
      useStore.setState({
        prices: { ...PRICES, packOptions: [{ key: 'zip', name: 'ЗИП-лок с бегунком', price: 45 }] },
      });
      expect(packName('zip')).toBe('ЗИП-лок с бегунком');
    });

    it('вид, которого нет в справочнике стора, — подпись кода, а не пусто', () => {
      useStore.setState({ prices: { ...PRICES, packOptions: [{ key: 'zip', name: 'ЗИП', price: 45 }] } });
      expect(packName('bopp')).toBe('БОПП пакет');
      expect(packName('other')).toBe('Другая — опишите в требованиях');
    });

    it('справочник передан явно — читается он', () => {
      expect(packName('bopp', [{ key: 'bopp', name: 'Пакет БОПП 30 мкм', price: 20 }])).toBe('Пакет БОПП 30 мкм');
    });
  });
});
