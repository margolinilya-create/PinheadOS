import { describe, it, expect } from 'vitest';
import { shouldBlockSalesLeave, salesHasUnsaved } from './leaveGuard';

describe('shouldBlockSalesLeave — уход с карточки v4 после сбоя сохранения', () => {
  it('сбой сохранения и уход в список — спросить', () => {
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales' })).toBe(true);
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales/o-2' })).toBe(true);
  });
  it('вложенный адрес того же заказа — не уход', () => {
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
