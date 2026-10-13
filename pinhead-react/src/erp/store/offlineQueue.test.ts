/**
 * Очередь записей, сделанных без связи.
 *
 * Она узкая намеренно: в ней ОДНА операция — приёмка материала. Причина
 * не в экономии сил, а в свойствах операции: приёмка накопительная («пришло
 * ещё 35» верно и через час) и идемпотентна по `client_key`, поэтому повтор
 * безопасен по построению. Переходы складских задач — стейт-машина, и
 * отправленное через час «упаковано» может приехать после отгрузки; такой
 * операции нужны правила разрешения конфликта, а не очередь.
 *
 * Самое опасное здесь — перепутать транзитную неудачу с окончательной.
 * Оставить в очереди отказ прав значит крутить его при каждом появлении связи
 * вечно; выбросить обрыв сети значит потерять то, ради чего очередь и заведена.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueue, flushQueue, queued, clearQueue, MAX_QUEUED } from './offlineQueue';
import { supabase } from '../../lib/supabase';

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

function entry(id: string) {
  return {
    id,
    kind: 'material_accept' as const,
    label: `Ткань ${id}`,
    at: '2026-08-22T10:00:00.000Z',
    args: { p_material_id: 'm1', p_client_key: id, p_qty: 60 },
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

describe('очередь без связи', () => {
  beforeEach(() => {
    clearQueue();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
    setOnline(true);
  });

  it('запись переживает перезагрузку страницы', () => {
    enqueue(entry('a'));
    // Хранилище, а не память: планшет закрывают и роняют, и очередь в памяти —
    // это то же потерянное набранное, только позже
    expect(localStorage.getItem('erp_offline_queue')).toContain('"a"');
    expect(queued()).toHaveLength(1);
  });

  it('отправляет накопленное по порядку и очищает очередь', async () => {
    enqueue(entry('a'));
    enqueue(entry('b'));

    const sent = await flushQueue();

    expect(sent).toBe(2);
    expect(queued()).toHaveLength(0);
    expect(rpc.mock.calls.map((c) => c[1].p_client_key)).toEqual(['a', 'b']);
  });

  it('каждая запись уходит со своим ключом идемпотентности', async () => {
    enqueue(entry('a'));
    await flushQueue();
    // Без ключа повторная отправка удвоила бы приход — то есть количество
    // материала на фабрике
    expect(rpc.mock.calls[0][1]).toHaveProperty('p_client_key', 'a');
  });

  it('обрыв сети оставляет запись — это «ещё не время»', async () => {
    enqueue(entry('a'));
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));

    const sent = await flushQueue();

    expect(sent).toBe(0);
    expect(queued()).toHaveLength(1);
  });

  /**
   * Ответ сервера — это решение, а не помеха. Повторять его бессмысленно:
   * запись будет всплывать при каждом появлении связи вечно.
   */
  it('отказ сервера убирает запись и называет причину', async () => {
    enqueue(entry('a'));
    rpc.mockResolvedValue({ data: null, error: { message: 'нет прав на это действие' } });

    const sent = await flushQueue();

    expect(sent).toBe(0);
    expect(queued(), 'отказ прав остался крутиться в очереди').toHaveLength(0);
  });

  it('одна неудача не мешает остальным уйти', async () => {
    enqueue(entry('a'));
    enqueue(entry('b'));
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'материал не найден' } })
      .mockResolvedValueOnce({ data: null, error: null });

    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(queued()).toHaveLength(0);
  });

  it('без связи не пытается отправлять вовсе', async () => {
    enqueue(entry('a'));
    setOnline(false);

    await flushQueue();

    expect(rpc).not.toHaveBeenCalled();
    expect(queued()).toHaveLength(1);
  });

  /**
   * Потолок: очередь — это забытый на смену планшет, а не архив. Без него
   * localStorage переполняется, и запись перестаёт сохраняться молча.
   */
  it('держит потолок и говорит об этом', () => {
    for (let i = 0; i < MAX_QUEUED; i += 1) enqueue(entry(`x${i}`));
    expect(enqueue(entry('over'))).toBe(false);
    expect(queued()).toHaveLength(MAX_QUEUED);
  });

  it('битое хранилище не роняет экран', () => {
    localStorage.setItem('erp_offline_queue', 'не json');
    expect(queued()).toEqual([]);
  });
});
