import { describe, it, expect } from 'vitest';
import { orderLinkTarget } from './orderLink';

/**
 * Контекст возврата в карточку заказа.
 *
 * Формат `from` обязан совпадать с ключом `useScrollRestore`
 * (`erp_scroll:${pathname}${search}`): разойдутся — возврат попадёт на другой
 * ключ, и позиция прокрутки не восстановится молча, без единой ошибки.
 */
describe('orderLinkTarget', () => {
  it('несёт путь и параметры списка целиком', () => {
    const [to, options] = orderLinkTarget('o1', {
      pathname: '/orders',
      search: '?tab=archive&filter=overdue&page=3',
    });
    expect(to).toBe('/orders/o1');
    expect(options.state.from).toBe('/orders?tab=archive&filter=overdue&page=3');
  });

  it('без параметров даёт чистый путь, а не «/orders?»', () => {
    const [, options] = orderLinkTarget('o1', { pathname: '/board', search: '' });
    // Лишний «?» дал бы другой ключ прокрутки, чем у самого экрана
    expect(options.state.from).toBe('/board');
  });

  it('работает из любого раздела, не только из списка заказов', () => {
    // В заказ приходят из очереди цеха, канбана, плана, дашборда и закупки —
    // возврат обязан вести туда же, откуда пришли, а не в список заказов
    const [, options] = orderLinkTarget('o1', {
      pathname: '/queue/sewing',
      search: '?group=ready',
    });
    expect(options.state.from).toBe('/queue/sewing?group=ready');
  });
});
