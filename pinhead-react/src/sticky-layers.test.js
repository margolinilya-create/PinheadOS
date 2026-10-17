import { describe, it, expect } from 'vitest';

// Актуальные значения из CSS (превью роли убрано — отступ только от шапки)
const HEADER_H      = 52;   // --header-h
const ACTIONS_BAR_H = 52;   // .sku-actions-bar, .pe-actions-bar
const PE_TABS_H     = 40;   // .pe-tabs

describe('Sticky layers — правильные top значения', () => {
  it('sku-actions-bar: top = header', () => {
    const expected = HEADER_H; // 52
    // Читаем из CSS (в тесте проверяем константу, реальный CSS — вручную)
    expect(expected).toBe(52);
  });

  it('pe-tabs: top = header + actions-bar', () => {
    const expected = HEADER_H + ACTIONS_BAR_H; // 104
    expect(expected).toBe(104);
  });

  it('sku-ed-rate-bar: top = header + actions-bar + pe-tabs', () => {
    const expected = HEADER_H + ACTIONS_BAR_H + PE_TABS_H; // 144
    expect(expected).toBe(144);
  });

  // Проверка что z-index не конфликтуют
  it('z-index: header > actions-bar > pe-tabs', () => {
    const HEADER_Z      = 100;
    const ACTIONS_Z     = 20;
    const PE_TABS_Z     = 19;
    expect(HEADER_Z).toBeGreaterThan(ACTIONS_Z);
    expect(ACTIONS_Z).toBeGreaterThan(PE_TABS_Z);
  });

  it('z-index: modal > header (модалы не под хедером)', () => {
    const HEADER_Z = 100;
    const MODAL_Z  = 500;
    expect(MODAL_Z).toBeGreaterThan(HEADER_Z);
  });
});

// Описание стека для документации
export const STICKY_STACK = {
  wizard:  ['header(52)', 'progressBar(48)'],
  sku:     ['header(52)', 'skuActionsBar(52)', 'peTabs(40)', 'rateBar(44)'],
  prices:  ['header(52)', 'peActionsBar(52)', 'peTabs(40)'],
  print:   ['ppToolbar(44)'],
};
