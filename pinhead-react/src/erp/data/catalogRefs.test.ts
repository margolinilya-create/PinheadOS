import { describe, expect, it } from 'vitest';
import { catalogRefsFrom, EMPTY_REFS, FIT_LABELS } from './catalogRefs';

describe('catalogRefsFrom — каталог как источник подсказок заказа', () => {
  const RAW = {
    skuCatalog: [
      { code: 'T-001', name: 'Футболка Classic', fit: 'regular' },
      { code: 'T-005', name: 'Футболка Oversize', fit: 'oversize' },
      { code: 'H-004', name: 'Худи Oversize', fit: 'oversize' },
      { code: 'X-001', name: 'Шоппер', fit: null },
    ],
    fabricsCatalog: [
      { code: 'a', name: 'Кулирка', composition: '100% хб', density: 160 },
      { code: 'b', name: 'Кулирка', composition: '100% хб', density: 250 },
      { code: 'c', name: 'Пике', composition: '100% хб' },
    ],
    trimCatalog: [
      { code: 'r', name: 'Рибана 1×1', composition: '95% хб / 5% лайкра', density: 220 },
    ],
  };

  it('изделия берутся из каталога SKU по названию', () => {
    expect(catalogRefsFrom(RAW).productTypes).toEqual([
      'Футболка Classic', 'Футболка Oversize', 'Худи Oversize', 'Шоппер',
    ]);
  });

  it('крой сжимается до того, что фабрика реально шьёт, и приходит подписью', () => {
    // В каталоге два oversize и один regular — дубль схлопывается,
    // а SKU без кроя (шоппер) в список не попадает вовсе
    expect(catalogRefsFrom(RAW).fits).toEqual([FIT_LABELS.regular, FIT_LABELS.oversize]);
  });

  it('крой с незнакомым кодом остаётся собой, а не исчезает', () => {
    const refs = catalogRefsFrom({ skuCatalog: [{ name: 'Пальто', fit: 'boxy' }] });
    expect(refs.fits).toEqual(['boxy']);
  });

  it('ткань различается составом и плотностью, а не одним названием', () => {
    // Восемь «Кулирок» в каталоге отличаются только этим: одно название
    // не отвечает закупщику, что именно покупать
    expect(catalogRefsFrom(RAW).fabrics).toEqual([
      'Кулирка · 100% хб · 160 г/м²',
      'Кулирка · 100% хб · 250 г/м²',
      'Пике · 100% хб',
    ]);
  });

  it('отделочные материалы читаются тем же правилом', () => {
    expect(catalogRefsFrom(RAW).trims).toEqual(['Рибана 1×1 · 95% хб / 5% лайкра · 220 г/м²']);
  });

  it('пустые и битые названия отбрасываются', () => {
    const refs = catalogRefsFrom({
      skuCatalog: [{ name: '  ' }, { name: 'Худи' }, { name: 'Худи' }, { code: 'no-name' }],
    });
    expect(refs.productTypes).toEqual(['Худи']);
  });

  it('каталога нет — подсказок нет, а не падение', () => {
    // Форма обязана работать без каталога: поле остаётся свободным вводом
    expect(catalogRefsFrom(null)).toEqual(EMPTY_REFS);
    expect(catalogRefsFrom({})).toEqual(EMPTY_REFS);
    expect(catalogRefsFrom({ skuCatalog: 'не массив' })).toEqual(EMPTY_REFS);
    expect(catalogRefsFrom({ skuCatalog: [null, 42, 'строка'] })).toEqual(EMPTY_REFS);
  });
});
