import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useErpStore } from '../store/useErpStore';
import { useShipConfirm, shipConfirmOptions } from './useShipConfirm';

/**
 * ПРЕДУПРЕЖДЕНИЕ ПРИ ОТГРУЗКЕ (правки 19.10, п. 7, «Завершение заказа»):
 * «при закрытии заказа предупредить об открытых бизнес-задачах и показать
 * их список. Закрытие заказа не завершает задачи автоматически» — и «по
 * умолчанию бизнес-задача не блокирует закрытие заказа». Отсюда два
 * сторожа: список виден, и «Отгрузить» отгрузку продолжает.
 */

const confirm = vi.fn();
vi.mock('../../store/useConfirmStore', () => ({ confirm: (...a) => confirm(...a) }));

const ORDER = { id: 'o1', title: 'Худи' };
const T = (over = {}) => ({
  id: 't1', order_id: 'o1', title: 'Заказать молнии', status: 'in_progress', ...over,
});

let load;
beforeEach(() => {
  confirm.mockReset();
  load = vi.fn(async () => []);
  useErpStore.setState({ loadOrderBizTasks: load });
});

const hook = () => renderHook(() => useShipConfirm()).result.current;

describe('useShipConfirm', () => {
  it('отгрузка с открытыми задачами — список, «Отгрузить» продолжает', async () => {
    load.mockResolvedValue([
      T(),
      T({ id: 't2', title: 'Забрать ткань', status: 'review' }),
      T({ id: 't3', title: 'Готовое', status: 'done' }),
      T({ id: 't4', title: 'Снятое', status: 'cancelled' }),
    ]);
    confirm.mockResolvedValue(true);
    const ask = hook();
    let ok;
    await act(async () => { ok = await ask(ORDER, { message: 'Заказ уйдёт в архив.' }); });
    expect(ok).toBe(true);
    expect(load).toHaveBeenCalledWith('o1');
    const opts = confirm.mock.calls[0][0];
    expect(opts.confirmLabel).toBe('Отгрузить');
    expect(opts.cancelLabel).toBe('Не отгружать');
    expect(opts.message).toContain('Открытые бизнес-задачи: 2');
    expect(opts.message).toContain('«Заказать молнии»');
    expect(opts.message).toContain('«Забрать ткань»');
    expect(opts.message).not.toContain('Готовое');
    expect(opts.message).not.toContain('Снятое');
  });

  it('«Не отгружать» — отгрузки нет', async () => {
    load.mockResolvedValue([T()]);
    confirm.mockResolvedValue(false);
    const ask = hook();
    let ok;
    await act(async () => { ok = await ask(ORDER); });
    expect(ok).toBe(false);
  });

  it('без открытых задач — прежний текст', async () => {
    load.mockResolvedValue([T({ status: 'done' })]);
    confirm.mockResolvedValue(true);
    const ask = hook();
    await act(async () => { await ask(ORDER, { message: 'Заказ уйдёт в архив.' }); });
    expect(confirm).toHaveBeenCalledWith({
      title: 'Отгрузить заказ «Худи»?',
      message: 'Заказ уйдёт в архив.',
      confirmLabel: 'Отгрузить',
    });
  });

  it('без открытых задач и onlyIfTasks — диалога нет, отгрузка идёт', async () => {
    const ask = hook();
    let ok;
    await act(async () => { ok = await ask(ORDER, { onlyIfTasks: true }); });
    expect(ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('сбой чтения задач отгрузку не блокирует — прежний вопрос', async () => {
    load.mockResolvedValue(null);
    confirm.mockResolvedValue(true);
    const ask = hook();
    let ok;
    await act(async () => { ok = await ask(ORDER, { message: 'Заказ уйдёт в архив.' }); });
    expect(ok).toBe(true);
    expect(confirm.mock.calls[0][0].message).toBe('Заказ уйдёт в архив.');
  });
});

describe('shipConfirmOptions', () => {
  it('длинный список обрезается с честным «и ещё N»', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => T({ id: `t${i}`, title: `З${i}` }));
    const o = shipConfirmOptions(ORDER, tasks);
    expect(o.message).toContain('Открытые бизнес-задачи: 12');
    expect(o.message).toContain('и ещё 2');
    expect(o.message).toContain('не завершает');
  });
});
