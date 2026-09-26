// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearRealtimeTimers,
  scheduleExperimentalReload,
  scheduleFullReload,
  scheduleOrderReload,
  schedulePing,
  ORDER_RELOAD_DEBOUNCE_MS,
  EXPERIMENTAL_RELOAD_DEBOUNCE_MS,
  CHAT_PING_DEBOUNCE_MS,
} from './realtimeCoalesce';
import { FULL_RELOAD_DEBOUNCE_MS } from './shared';

/**
 * Серия событий → один вызов; события разных заказов — независимы; отписка
 * гасит всё. Мутации (проверены 26.09): убрать `clearTimeout` в `restart` —
 * серия даёт N вызовов; убрать `orderTimers.delete` — таймер второго заказа
 * не отличим от первого только при общем таймере, поэтому Map проверяется
 * отдельным случаем.
 */
describe('realtimeCoalesce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearRealtimeTimers();
    vi.useRealTimers();
  });

  it('пять INSERT этапов одного заказа → одно перечитывание', () => {
    const fn = vi.fn();
    for (let i = 0; i < 5; i++) scheduleOrderReload('o1', fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ORDER_RELOAD_DEBOUNCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('события двух заказов не глушат друг друга', () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleOrderReload('o1', a);
    scheduleOrderReload('o2', b);
    vi.advanceTimersByTime(ORDER_RELOAD_DEBOUNCE_MS);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('серия продлевает паузу: вызов — после ПОСЛЕДНЕГО события', () => {
    const fn = vi.fn();
    scheduleOrderReload('o1', fn);
    vi.advanceTimersByTime(ORDER_RELOAD_DEBOUNCE_MS - 50);
    scheduleOrderReload('o1', fn);
    vi.advanceTimersByTime(ORDER_RELOAD_DEBOUNCE_MS - 50);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('три события разработки → одно перечитывание доски', () => {
    const fn = vi.fn();
    scheduleExperimentalReload(fn);
    scheduleExperimentalReload(fn);
    scheduleExperimentalReload(fn);
    vi.advanceTimersByTime(EXPERIMENTAL_RELOAD_DEBOUNCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('четыре сообщения чата → один звонок', () => {
    const fn = vi.fn();
    for (let i = 0; i < 4; i++) schedulePing(fn);
    vi.advanceTimersByTime(CHAT_PING_DEBOUNCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('полная перезагрузка — одна на серию', () => {
    const fn = vi.fn();
    scheduleFullReload(fn);
    scheduleFullReload(fn);
    vi.advanceTimersByTime(FULL_RELOAD_DEBOUNCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clearRealtimeTimers гасит всё отложенное', () => {
    const fn = vi.fn();
    scheduleOrderReload('o1', fn);
    scheduleExperimentalReload(fn);
    schedulePing(fn);
    scheduleFullReload(fn);
    clearRealtimeTimers();
    vi.advanceTimersByTime(FULL_RELOAD_DEBOUNCE_MS * 2);
    expect(fn).not.toHaveBeenCalled();
  });
});
