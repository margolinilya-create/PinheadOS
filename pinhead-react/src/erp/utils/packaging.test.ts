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
  it('«без упаковки» без комментария показывать нечего', () => {
    expect(hasPackaging({ type: 'none', note: null, inherited: true })).toBe(false);
  });

  it('«без упаковки» С комментарием — это уже требование', () => {
    expect(hasPackaging({ type: 'none', note: 'россыпью в коробе', inherited: false })).toBe(true);
  });

  it('любой тип упаковки показывается', () => {
    expect(hasPackaging({ type: 'zip', note: null, inherited: false })).toBe(true);
  });
});

describe('подписи', () => {
  it('упаковка с комментарием собирается одной строкой', () => {
    expect(packagingLabel({ type: 'bopp', note: 'пакет 40×60', inherited: true }))
      .toBe('БОПП-пакет: пакет 40×60');
  });

  it('упаковка без комментария — только тип', () => {
    expect(packagingLabel({ type: 'zip', note: null, inherited: false })).toBe('ZIP-пакет');
  });

  it('стикеры остаются на заказе; «нет» не показывается вовсе', () => {
    expect(stickersLabel('none', null)).toBeNull();
    expect(stickersLabel(null, null)).toBeNull();
    expect(stickersLabel('blank', null)).toBe('Бланк');
    expect(stickersLabel('other', 'на горловину')).toBe('Другое — на горловину');
  });
});
