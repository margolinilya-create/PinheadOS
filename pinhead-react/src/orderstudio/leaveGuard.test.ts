import { describe, it, expect } from 'vitest';
import { shouldBlockLeave } from './leaveGuard';

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
