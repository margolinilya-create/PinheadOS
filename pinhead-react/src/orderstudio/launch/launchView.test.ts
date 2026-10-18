import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../model/factory';
import type { SalesOrderListRow } from '../api/salesOrders';
import { launchDateWarnings, launchSummary, marginLine, nextInQueue, routeRows } from './launchView';

const grid = (qty: number) => ({ sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: qty } }] });

const order = newSalesOrder({
  id: 'o-1',
  number: 'PH-1',
  status: 'ready_to_launch',
  due_date: '2026-10-24',
  items: [
    newSalesItem({ product_type: 'Футболка', size_grid: grid(300), prints: [newSalesPrint({ method: 'dtf' }), newSalesPrint({ method: 'dtf' })] }),
    newSalesItem({ product_type: 'Худи', size_grid: grid(150), prints: [newSalesPrint({ method: 'embroidery', on: 'finished' })] }),
    newSalesItem({ product_type: 'Кепка', size_grid: grid(0) }),
  ],
});

describe('launchDateWarnings', () => {
  it('позже срока сдачи и выходной — оба предупреждения', () => {
    expect(launchDateWarnings('2026-10-25', '2026-10-24')).toEqual([
      'Запуск 25.10 позже срока сдачи 24.10',
      'Воскресенье — нерабочий день',
    ]);
    expect(launchDateWarnings('2026-10-24', '2026-10-24')).toEqual(['Суббота — нерабочий день']);
    expect(launchDateWarnings('2026-10-20', '2026-10-24')).toEqual([]);
    expect(launchDateWarnings('2026-10-20', null)).toEqual([]);
    expect(launchDateWarnings('', '2026-10-24')).toEqual([]);
  });
});

describe('launchSummary', () => {
  it('позиции с количеством, штуки, дата с днём недели, предупреждения моста', () => {
    expect(launchSummary(order, '2026-10-20', 1)).toBe(
      'Будет создан заказ в производстве: 2 позиции, 450 шт., запуск 20.10 (вт). Предупреждений моста: 1.',
    );
  });

  it('без предупреждений моста — без хвоста; предупреждения даты — в сводке', () => {
    expect(launchSummary(order, '2026-10-25', 0)).toBe(
      'Будет создан заказ в производстве: 2 позиции, 450 шт., запуск 25.10 (вс). Запуск 25.10 позже срока сдачи 24.10. Воскресенье — нерабочий день.',
    );
  });
});

describe('routeRows', () => {
  it('техники подписями модели, без пустых позиций; где идут нанесения', () => {
    const rows = routeRows(order);
    expect(rows.map((r) => [r.name, r.qty, r.methods])).toEqual([
      ['Футболка', 300, ['DTF']],
      ['Худи', 150, ['Вышивка']],
    ]);
    expect(rows[0].production).toBe('Пошив');
    expect(rows[1].brandingOn).toBe('по готовому изделию');
  });
});

describe('marginLine', () => {
  it('ниже порога — признак low, текст с порогом', () => {
    expect(marginLine(0.18, 0.25)).toEqual({ text: 'Маржа 18 % (порог 25 %)', low: true });
    expect(marginLine(0.3, 0.25)).toEqual({ text: 'Маржа 30 % (порог 25 %)', low: false });
    expect(marginLine(0.3, null)).toEqual({ text: 'Маржа 30 %', low: false });
  });
});

describe('nextInQueue', () => {
  const row = (id: string, due: string | null, status = 'ready_to_launch') => ({ id, due_date: due, status, updated_at: '2026-10-18T10:00:00Z' }) as SalesOrderListRow;
  it('следующий по сроку среди ждущих запуска, без текущего', () => {
    const list = [row('a', '2026-10-30'), row('cur', '2026-10-19'), row('b', '2026-10-21'), row('c', null), row('d', '2026-10-20', 'draft')];
    expect(nextInQueue(list, 'cur')).toEqual({ next: list[2], left: 3 });
    expect(nextInQueue([row('cur', null)], 'cur')).toEqual({ next: null, left: 0 });
  });
});
