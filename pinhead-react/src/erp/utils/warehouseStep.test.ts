import { describe, expect, it } from 'vitest';
import type { ErpWarehouseTask } from '../types';
import { warehouseStep } from './warehouseStep';

/**
 * Финальный шаг «Склад» в маршруте позиции.
 *
 * Документ перечисляет «Склад» среди этапов маршрута, а у подряда под ключ
 * маршрут состоит из двух шагов — «Подряд — Склад». Этапом это не заводится
 * (непроизводственный цех не попадает ни в очередь, ни на канбан — на этом
 * 12.08 встали 33 заказа), поэтому шаг ВЫЧИСЛЯЕТСЯ из задач склада.
 *
 * Сторож проверяет ровно то, ради чего шаг заведён: маршрут не обрывается
 * на последнем цехе, и человек видит, где заказ стоит на складе.
 */

const task = (over: Partial<ErpWarehouseTask> = {}): ErpWarehouseTask => ({
  id: 't1', order_id: 'o1', item_id: null, stage_id: null,
  task_type: 'pack_ship', status: 'awaiting_receipt',
  assignee: null, note: null, created_at: '', updated_at: '', ...over,
} as ErpWarehouseTask);

describe('финальный шаг «Склад»', () => {
  it('без задач склада — ждёт производство, а не «готово»', () => {
    // «Нет задач» не означает «сделано»: их заводят триггеры по мере
    // закрытия производства. Считать пустоту готовностью — врать в маршруте
    const step = warehouseStep({ warehouse_tasks: [] });
    expect(step.state).toBe('waiting');
    expect(step.label).toBe('Ожидает производство');
  });

  it('показывает ПЕРВУЮ незакрытую задачу — ею склад и занят', () => {
    const step = warehouseStep({
      warehouse_tasks: [
        task({ id: 'a', task_type: 'pack_ship', status: 'awaiting_receipt' }),
        task({ id: 'b', task_type: 'fg_receipt', status: 'awaiting_receipt' }),
      ],
    });
    // Порядок склада: приёмка ГП → маркировка → упаковка, а не порядок в массиве
    expect(step.label).toBe('Ожидает: приёмка готовой продукции');
  });

  it('различает «ждёт» и «в работе»', () => {
    expect(warehouseStep({
      warehouse_tasks: [task({ task_type: 'pack_ship', status: 'packing' })],
    })).toMatchObject({ state: 'in_progress', label: 'Упаковка и отгрузка' });

    expect(warehouseStep({
      warehouse_tasks: [task({ task_type: 'marking', status: 'new' })],
    })).toMatchObject({ state: 'waiting' });

    expect(warehouseStep({
      warehouse_tasks: [task({ task_type: 'marking', status: 'in_progress' })],
    })).toMatchObject({ state: 'in_progress', label: 'Маркировка' });
  });

  it('закрытые задачи склада закрывают шаг', () => {
    const step = warehouseStep({
      warehouse_tasks: [
        task({ id: 'a', task_type: 'fg_receipt', status: 'accepted' }),
        task({ id: 'b', task_type: 'marking', status: 'issued' }),
        task({ id: 'c', task_type: 'pack_ship', status: 'shipped' }),
      ],
    });
    expect(step.state).toBe('done');
  });

  it('отгрузка заказа сильнее любых задач', () => {
    // Заказ отгружен — маршрут закончен, даже если какая-то задача осталась
    // незакрытой руками. Обратное неверно, и это проверено выше
    const step = warehouseStep({
      shipped_at: '2026-08-21T10:00:00Z',
      warehouse_tasks: [task({ task_type: 'marking', status: 'new' })],
    });
    expect(step).toMatchObject({ state: 'done', label: 'Отгружено', shipped: true });
  });

  it('задачи приёмки материалов и подряда шагом НЕ считаются', () => {
    /**
     * Приёмка материалов идёт ДО производства, приёмка подряда — ВНУТРИ
     * маршрута (у неё свой подрядный этап). Финальный шаг — про то, что
     * происходит ПОСЛЕ цехов; подмешать их значило бы показать «Склад»
     * в работе, когда заказ ещё кроят
     */
    const step = warehouseStep({
      warehouse_tasks: [
        task({ task_type: 'material_receipt', status: 'awaiting' }),
        task({ task_type: 'subcontract_receipt', status: 'awaiting_receipt' }),
      ],
    });
    expect(step.label).toBe('Ожидает производство');
  });
});
