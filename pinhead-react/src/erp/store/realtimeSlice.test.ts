/**
 * Реалтайм переживает сон планшета и обрыв цехового Wi-Fi.
 *
 * До 22.08 у `.subscribe()` не было обработчика статуса ВООБЩЕ: `CHANNEL_ERROR`
 * и `TIMED_OUT` не ловились ничем, а слушателей `visibilitychange`/`online`/
 * `focus` в проекте не было ни одного (проверено grep-ом по `src/`). Планшет,
 * ушедший в сон или потерявший сеть, возвращался с молча устаревшей очередью:
 * события за время разрыва не приходят НИКОГДА, а признака разрыва не было.
 *
 * Экран при этом выглядит совершенно рабочим — он просто показывает
 * позавчерашнюю работу. Из всех дефектов, найденных перед внедрением, этот
 * был самым вероятным «звонком из цеха».
 *
 * Тест проверяет ПОВЕДЕНИЕ (событие → перезагрузка), а не наличие имён
 * в тексте: сторож, сверяющий имена, зелен и тогда, когда обработчик
 * зарегистрирован, но ничего не делает.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useErpStore, resetErpStore } from './useErpStore';
import { supabase } from '../../lib/supabase';

/** Последний колбэк, переданный в `.subscribe(...)` — им и двигаем состояние канала */
let statusCb: ((status: string) => void) | null = null;

function mockChannel() {
  statusCb = null;
  vi.mocked(supabase.channel).mockImplementation(() => {
    const ch: Record<string, unknown> = {};
    ch.on = vi.fn(() => ch);
    ch.subscribe = vi.fn((cb?: (status: string) => void) => {
      if (cb) statusCb = cb;
      return ch;
    });
    return ch as never;
  });
}

/** Управляемая видимость вкладки: jsdom по умолчанию отдаёт 'visible' */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => state,
  });
}

describe('resyncRealtime', () => {
  beforeEach(() => {
    resetErpStore();
    setVisibility('visible');
  });

  it('перечитывает заказы и снимает признак устаревания', async () => {
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll, realtimeLive: false });

    await useErpStore.getState().resyncRealtime();

    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(useErpStore.getState().realtimeLive).toBe(true);
    expect(useErpStore.getState().realtimeResyncing).toBe(false);
  });

  /**
   * Флаг снимается в `finally`. Иначе неудачная перезагрузка оставляла бы
   * полосу «Обновляем данные…» навсегда — вечный индикатор вместо признака
   * состояния, то есть ровно то, от чего эта полоса и ставится.
   */
  it('сбой перезагрузки не оставляет полосу «обновляем» навсегда', async () => {
    const loadAll = vi.fn().mockRejectedValue(new Error('нет связи'));
    useErpStore.setState({ loadAll, realtimeLive: false });

    await expect(useErpStore.getState().resyncRealtime()).rejects.toThrow();
    expect(useErpStore.getState().realtimeResyncing).toBe(false);
  });

  it('в скрытой вкладке не ходит в сеть', async () => {
    setVisibility('hidden');
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll });

    await useErpStore.getState().resyncRealtime();

    expect(loadAll).not.toHaveBeenCalled();
  });
});

describe('subscribeRealtime: разрыв канала и возврат', () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    resetErpStore();
    setVisibility('visible');
    mockChannel();
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    vi.useRealTimers();
  });

  it('обработчик статуса вообще передан в subscribe', () => {
    unsubscribe = useErpStore.getState().subscribeRealtime();
    // Без него разрыв канала не даёт ни события, ни признака —
    // именно этого обработчика и не было
    expect(statusCb, 'у .subscribe() нет колбэка статуса').toBeTypeOf('function');
  });

  it('CHANNEL_ERROR помечает данные возможно устаревшими', () => {
    unsubscribe = useErpStore.getState().subscribeRealtime();
    expect(useErpStore.getState().realtimeLive).toBe(true);

    statusCb!('CHANNEL_ERROR');

    expect(useErpStore.getState().realtimeLive).toBe(false);
  });

  it('TIMED_OUT и CLOSED — то же самое', () => {
    unsubscribe = useErpStore.getState().subscribeRealtime();
    statusCb!('TIMED_OUT');
    expect(useErpStore.getState().realtimeLive).toBe(false);

    useErpStore.setState({ realtimeLive: true });
    statusCb!('CLOSED');
    expect(useErpStore.getState().realtimeLive).toBe(false);
  });

  /**
   * Восстановление канала САМО ПО СЕБЕ данных не приносит: пропущенные события
   * не переигрываются. Их можно только запросить заново — иначе экран остаётся
   * старым, хотя «связь есть».
   */
  it('после восстановления канала данные перечитываются', async () => {
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll });
    unsubscribe = useErpStore.getState().subscribeRealtime();

    statusCb!('CHANNEL_ERROR');
    statusCb!('SUBSCRIBED');
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalled());

    expect(useErpStore.getState().realtimeLive).toBe(true);
  });

  it('первое SUBSCRIBED лишней перезагрузки не делает', async () => {
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll });
    unsubscribe = useErpStore.getState().subscribeRealtime();

    statusCb!('SUBSCRIBED');
    await Promise.resolve();

    expect(loadAll).not.toHaveBeenCalled();
  });
});

describe('subscribeRealtime: пробуждение вкладки', () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    resetErpStore();
    setVisibility('visible');
    mockChannel();
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  });

  it.each(['online', 'focus'] as const)('событие %s перечитывает данные', async (event) => {
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll });
    unsubscribe = useErpStore.getState().subscribeRealtime();

    window.dispatchEvent(new Event(event));
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalled());
  });

  it('возврат вкладки перечитывает данные', async () => {
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll });
    unsubscribe = useErpStore.getState().subscribeRealtime();

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalled());
  });

  /**
   * Слушатели снимаются вместе с подпиской. Оставленные, они копятся на каждом
   * перемонтировании оболочки и превращают один возврат вкладки в N запросов.
   */
  it('отписка снимает слушателей', async () => {
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll });
    const stop = useErpStore.getState().subscribeRealtime();
    stop();

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(loadAll).not.toHaveBeenCalled();
  });
});
