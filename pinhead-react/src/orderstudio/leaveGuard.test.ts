import { describe, it, expect } from 'vitest';
import { shouldBlockLeave, shouldBlockSalesLeave, salesHasUnsaved } from './leaveGuard';

describe('shouldBlockLeave — диалог «Заказ не сохранён»', () => {
  it('уход с визарда с недоделанным заказом — спросить', () => {
    expect(shouldBlockLeave({ step: 1, saved: false, from: '/', to: '/orders' })).toBe(true);
  });
  it('навигация внутри «Заказов v4» при недоделанном заказе на главной — не спрашивать', () => {
    expect(shouldBlockLeave({ step: 3, saved: false, from: '/sales', to: '/sales/o-1' })).toBe(false);
    expect(shouldBlockLeave({ step: 3, saved: false, from: '/sales/o-1', to: '/sales/o-1/item/new' })).toBe(false);
  });
  it('шаг 0, сохранённый заказ, тот же адрес — не спрашивать', () => {
    expect(shouldBlockLeave({ step: 0, saved: false, from: '/', to: '/orders' })).toBe(false);
    expect(shouldBlockLeave({ step: 2, saved: true, from: '/', to: '/orders' })).toBe(false);
    expect(shouldBlockLeave({ step: 2, saved: false, from: '/', to: '/' })).toBe(false);
  });
});

describe('shouldBlockSalesLeave — уход с карточки v4 после сбоя сохранения', () => {
  it('сбой сохранения и уход в список — спросить', () => {
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales' })).toBe(true);
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales/o-2' })).toBe(true);
  });
  it('визард позиции того же заказа — не уход', () => {
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales/o-1/item/new' })).toBe(false);
  });
  it('без сбоя не спрашиваем: несохранённое догоняет flush при уходе', () => {
    expect(shouldBlockSalesLeave({ saveState: 'dirty', from: '/sales/o-1', to: '/sales' })).toBe(false);
    expect(shouldBlockSalesLeave({ saveState: 'clean', from: '/sales/o-1', to: '/sales' })).toBe(false);
  });
  it('уход не с карточки — не наше дело', () => {
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales', to: '/' })).toBe(false);
  });
});

describe('salesHasUnsaved — предупреждение при закрытии вкладки', () => {
  it('правка не ушла или ушла с ошибкой', () => {
    expect(['dirty', 'saving', 'error'].every(salesHasUnsaved)).toBe(true);
    expect(salesHasUnsaved('clean')).toBe(false);
  });
  it('outdated и conflict — правки в карточке так и не ушли: предупредить', () => {
    expect(['outdated', 'conflict'].every(salesHasUnsaved)).toBe(true);
  });
  it('locked — правка закрыта, терять нечего', () => {
    expect(salesHasUnsaved('locked')).toBe(false);
  });
});
