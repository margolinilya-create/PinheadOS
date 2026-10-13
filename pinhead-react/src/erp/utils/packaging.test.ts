import { describe, it, expect } from 'vitest';
import { hasPackaging, itemPackaging, packagingLabel, stickersLabel } from './packaging';

/**
 * Упаковка живёт в двух местах — на позиции и на заказе, — и правило разрешения
 * обязано быть одно. Тот же жанр, что `utils/tz.itemTzDocument`.
 */
describe('itemPackaging', () => {
  const order = { packaging: 'bopp' as const, packaging_note: 'пакет 40×60' };

  it('своя упаковка позиции перебивает общую', () => {
    const p = itemPackaging(order, { packaging: 'zip', packaging_note: 'стикер на лицевой' });
    expect(p.type).toBe('zip');
    expect(p.note).toBe('стикер на лицевой');
    expect(p.inherited).toBe(false);
  });

  it('inherit берёт упаковку заказа и помечает это', () => {
    const p = itemPackaging(order, { packaging: 'inherit', packaging_note: null });
    expect(p.type).toBe('bopp');
    expect(p.note).toBe('пакет 40×60');
    // Пометка нужна интерфейсу: «как в заказе» и «выбрано для этой позиции» —
    // разные вещи, и подпись у них тоже разная
    expect(p.inherited).toBe(true);
  });

  it('позиция БЕЗ колонки (заказ до правки) наследует, а не остаётся без упаковки', () => {
    // Трактовать отсутствие поля как `none` значило бы задним числом объявить,
    // что упаковка заказа к этим позициям не относится
    expect(itemPackaging(order, {}).type).toBe('bopp');
    expect(itemPackaging(order, { packaging: null }).type).toBe('bopp');
    expect(itemPackaging(order, undefined).type).toBe('bopp');
  });

  it('none у позиции — это ОСОЗНАННОЕ «не упаковывать», а не пустое значение', () => {
    const p = itemPackaging(order, { packaging: 'none' });
    expect(p.type).toBe('none');
    expect(p.inherited).toBe(false);
  });

  it('заказ без упаковки даёт none, а не падение', () => {
    expect(itemPackaging(null, { packaging: 'inherit' }).type).toBe('none');
    expect(itemPackaging({}, {}).type).toBe('none');
  });

  it('пустой комментарий не считается комментарием', () => {
    const p = itemPackaging(order, { packaging: 'zip', packaging_note: '   ' });
    expect(p.note).toBeNull();
  });
});

describe('hasPackaging', () => {
  /** Размер сам по себе показывать нечего: «нет упаковки 250×300 мм» — бессмыслица */
  const p = (patch = {}) => ({
    type: 'none' as const, note: null, width_mm: null, height_mm: null,
    sizeInherited: true, inherited: true, ...patch,
  });

  it('«без упаковки» без комментария показывать нечего', () => {
    expect(hasPackaging(p())).toBe(false);
  });

  it('«без упаковки» С комментарием — это уже требование', () => {
    expect(hasPackaging(p({ note: 'россыпью в коробе', inherited: false }))).toBe(true);
  });

  it('любой тип упаковки показывается', () => {
    expect(hasPackaging(p({ type: 'zip' as const, inherited: false }))).toBe(true);
  });
});

describe('подписи', () => {
  const p = (patch = {}) => ({
    type: 'none' as const, note: null, width_mm: null, height_mm: null,
    sizeInherited: true, inherited: true, ...patch,
  });

  it('упаковка с комментарием собирается одной строкой', () => {
    expect(packagingLabel(p({ type: 'bopp' as const, note: 'пакет 40×60' })))
      .toBe('БОПП-пакет: пакет 40×60');
  });

  it('упаковка без комментария — только тип', () => {
    expect(packagingLabel(p({ type: 'zip' as const, inherited: false }))).toBe('ZIP-пакет');
  });

  /**
   * Размер приписывается К ПОДПИСИ (правки 07.09, п. 16): цех читает
   * «БОПП-пакет 250×300 мм» одной строкой, а не собирает её из трёх полей.
   */
  it('размер в мм входит в подпись', () => {
    expect(packagingLabel(p({ type: 'bopp' as const, width_mm: 250, height_mm: 300 })))
      .toBe('БОПП-пакет 250×300 мм');
    expect(packagingLabel(p({
      type: 'zip' as const, width_mm: 200, height_mm: 250, note: 'с бегунком',
    }))).toBe('ZIP-пакет 200×250 мм: с бегунком');
  });

  it('у «Нет» размер не показывается — упаковки нет вовсе', () => {
    expect(packagingLabel(p({ width_mm: 250, height_mm: 300 }))).toBe('Нет');
  });

  it('стикеры остаются на заказе; «нет» не показывается вовсе', () => {
    expect(stickersLabel('none', null)).toBeNull();
    expect(stickersLabel(null, null)).toBeNull();
    expect(stickersLabel('blank', null)).toBe('Бланк');
    expect(stickersLabel('other', 'на горловину')).toBe('Другое — на горловину');
  });
});

/**
 * РАЗМЕР РАЗРЕШАЕТСЯ СВОИМ ВОПРОСОМ (правки 07.09, п. 16): позиция может брать
 * ТИП упаковки из заказа, а размер иметь свой — мешок под худи и пакет под
 * футболку в одной сделке. Поэтому у размера отдельный флаг `sizeInherited`.
 */
describe('размер упаковки: своё → общее', () => {
  const order = {
    packaging: 'bopp' as const, packaging_width_mm: 250, packaging_height_mm: 300,
  };

  it('свой размер позиции перебивает размер заказа', () => {
    const p = itemPackaging(order, {
      packaging: 'inherit', packaging_width_mm: 400, packaging_height_mm: 600,
    });
    expect([p.width_mm, p.height_mm]).toEqual([400, 600]);
    expect(p.sizeInherited).toBe(false);
    // Тип при этом унаследован — величины разные и разрешаются порознь
    expect(p.type).toBe('bopp');
    expect(p.inherited).toBe(true);
  });

  it('без своего размера берётся размер заказа', () => {
    const p = itemPackaging(order, { packaging: 'zip' });
    expect([p.width_mm, p.height_mm]).toEqual([250, 300]);
    expect(p.sizeInherited).toBe(true);
    expect(p.type).toBe('zip');
  });

  /** Одна сторона — не размер: «ширина 250, высота не задана» бесполезна цеху */
  it('одна сторона размером не считается', () => {
    const p = itemPackaging(
      { packaging: 'bopp' as const },
      { packaging: 'inherit', packaging_width_mm: 400 },
    );
    expect([p.width_mm, p.height_mm]).toEqual([null, null]);
  });

  it('размера нет нигде — оба null, ничего не падает', () => {
    const p = itemPackaging({ packaging: 'bopp' as const }, { packaging: 'inherit' });
    expect([p.width_mm, p.height_mm]).toEqual([null, null]);
    expect(p.sizeInherited).toBe(true);
  });
});
