import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

const { supabase } = await import('../../lib/supabase');
const { adminUsers } = await import('./adminUsers');

/** Мок объявлен выше: настоящая сигнатура `invoke` здесь только мешает */
const invoke = supabase.functions.invoke as unknown as Mock;

/**
 * Разбор ответа серверной функции.
 *
 * У `functions.invoke` механика ошибок НЕ такая, как у PostgREST: при любом
 * не-2xx он кладёт в `error` объект с единственным текстом «Edge Function
 * returned a non-2xx status code». Показать его человеку — это ровно тот
 * плоский шум, который правило проекта запрещает («Не удалось …» без причины):
 * отказ прав, занятый адрес и заказы, держащие удаление, выглядели бы одинаково.
 *
 * Настоящая причина лежит в теле ответа, и достать её нужно ОДИН раз здесь.
 */

/** Ошибка того же вида, что отдаёт supabase-js на не-2xx */
function httpError(body: unknown) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: { json: () => Promise.resolve(body) },
  };
}

beforeEach(() => {
  invoke.mockReset();
});

describe('adminUsers — вызов', () => {
  it('действие и данные уходят одним телом', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });

    await adminUsers('set_password', { user_id: 'u-1', password: 'secret123' });

    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set_password', user_id: 'u-1', password: 'secret123' },
    });
  });

  it('успех отдаёт данные функции', async () => {
    invoke.mockResolvedValue({ data: { id: 'u-9' }, error: null });

    const { data, error } = await adminUsers<{ id: string }>('create', {});

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'u-9' });
  });
});

describe('adminUsers — причина отказа', () => {
  it('берётся из тела ответа, а не из плоского «non-2xx»', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'Доступ только у администратора' }),
    });

    const { error } = await adminUsers('delete', { user_id: 'u-1' });

    expect(error?.message).toBe('Доступ только у администратора');
  });

  /** Упал сам рантайм функции — тела с причиной нет, но молчать нельзя */
  it('нечитаемое тело оставляет исходное сообщение', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: () => Promise.reject(new SyntaxError('not json')) },
      },
    });

    const { error } = await adminUsers('delete', { user_id: 'u-1' });

    expect(error?.message).toBe('Edge Function returned a non-2xx status code');
  });

  it('ошибка без контекста тоже не теряется', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Function not found' },
    });

    const { error } = await adminUsers('delete', { user_id: 'u-1' });

    expect(error?.message).toBe('Function not found');
  });

  /**
   * `invoke` БРОСАЕТ, когда ответа не было вовсе — нет сети, функция не выкачена.
   * Без перехвата это необработанное отклонение промиса: busy-флаг не снимется,
   * а человек увидит сырое «Load failed» из WebKit.
   */
  it('обрыв связи становится обычным отказом, а не броском', async () => {
    invoke.mockRejectedValue(new TypeError('Load failed'));

    const { data, error } = await adminUsers('create', {});

    expect(data).toBeNull();
    expect(error?.message).toBe('нет связи с сервером');
  });
});
