/**
 * Переподключение канала realtime НЕ ЗАЦИКЛИВАЕТСЯ и НЕ КОПИТ слушателей.
 *
 * ЧТО СЛОМАЛОСЬ (сессия 72, 28.09). Обработчик статуса канала на `CLOSED`
 * ставил таймер переподключения — в том числе на `CLOSED`, который прислал
 * НАШ ЖЕ `dropChannel()` из предыдущего переподключения. Старый канал,
 * закрытый нами, будил новое переподключение, оно закрывало уже новый канал
 * и заводило следующий — и так без конца: каждый круг оставлял в живых ещё
 * один канал (со всеми шестнадцатью подписками), ещё пару слушателей
 * `visibilitychange`/`online` и ещё один полный `loadAll` при `SUBSCRIBED`.
 * За сутки открытая вкладка цеха накапливала сотни каналов; на проде это
 * читалось как «ничего не загружается»: по 7 800 рукопожатий WebSocket
 * в сутки и всплески в сотни одинаковых запросов списка заказов.
 *
 * `supabase-js` сам переподписывает канал после обрыва (`rejoinTimer`),
 * поэтому наше пересоздание — запасной ход на случай, когда библиотека
 * застряла, а не реакция на каждый чих. Мок канала ниже повторяет одно
 * свойство настоящего: `removeChannel()` присылает колбэку статуса `CLOSED`
 * синхронно — именно так ведёт себя `RealtimeChannel.unsubscribe()`
 * при мёртвом сокете (`leavePush.trigger('ok')` без сети).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useErpStore, resetErpStore } from './useErpStore';
import { supabase } from '../../lib/supabase';
import { RECONNECT_STEPS_MS } from './slices/realtimeSlice';

type StatusCb = (status: string) => void;

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  cb: StatusCb | null;
}

const channels: FakeChannel[] = [];

function mockChannels() {
  channels.length = 0;
  // Счётчики вызовов — с нуля: иначе отписка прошлого теста входит в счёт этого
  vi.mocked(supabase.channel).mockClear();
  vi.mocked(supabase.removeChannel).mockClear();
  vi.mocked(supabase.channel).mockImplementation(() => {
    const ch: FakeChannel = { on: vi.fn(), subscribe: vi.fn(), cb: null };
    ch.on.mockReturnValue(ch);
    ch.subscribe.mockImplementation((cb?: StatusCb) => { ch.cb = cb ?? null; return ch; });
    channels.push(ch);
    return ch as never;
  });
  vi.mocked(supabase.removeChannel).mockImplementation(async (ch) => {
    // Как настоящий клиент при мёртвом сокете: отписка = синхронный CLOSED
    (ch as unknown as FakeChannel).cb?.('CLOSED');
    return 'ok';
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

/** Сколько слушателей `visibilitychange` висит на документе сейчас */
function countVisibilityListeners(add: ReturnType<typeof vi.spyOn>, remove: ReturnType<typeof vi.spyOn>) {
  const isVis = (call: unknown[]) => call[0] === 'visibilitychange';
  const added = (add.mock.calls as unknown[][]).filter(isVis).length;
  const removed = (remove.mock.calls as unknown[][]).filter(isVis).length;
  return added - removed;
}

describe('subscribeRealtime: переподключение', () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    resetErpStore();
    setVisibility('visible');
    mockChannels();
    useErpStore.setState({ loadAll: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('CLOSED от канала, который мы сами закрыли, не заводит новое переподключение', () => {
    unsubscribe = useErpStore.getState().subscribeRealtime();
    expect(channels).toHaveLength(1);

    channels[0].cb!('CHANNEL_ERROR');
    vi.advanceTimersByTime(RECONNECT_STEPS_MS[0]);
    // Первое переподключение: старый канал закрыт (и прислал CLOSED), новый создан
    expect(channels).toHaveLength(2);
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);

    channels[1].cb!('SUBSCRIBED');
    // Дальше НИЧЕГО не должно происходить, сколько бы времени ни прошло:
    // в сломанной версии CLOSED старого канала ставил следующий таймер,
    // и каждый круг добавлял ещё один живой канал
    vi.advanceTimersByTime(10 * 60_000);
    expect(channels, 'каналы плодятся без новых ошибок').toHaveLength(2);
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('после переподключения живой канал ровно один — прежние закрыты', () => {
    unsubscribe = useErpStore.getState().subscribeRealtime();
    for (let round = 0; round < 3; round += 1) {
      const live = channels[channels.length - 1];
      live.cb!('CHANNEL_ERROR');
      vi.advanceTimersByTime(60_000);
      channels[channels.length - 1].cb!('SUBSCRIBED');
    }
    // Три ошибки — три пересоздания, и каждый предшественник закрыт
    expect(channels).toHaveLength(4);
    expect(supabase.removeChannel).toHaveBeenCalledTimes(3);
    const dropped = vi.mocked(supabase.removeChannel).mock.calls.map(([ch]) => ch);
    expect(dropped).toEqual(channels.slice(0, 3));
  });

  it('слушатели окна не копятся с каждым переподключением', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    unsubscribe = useErpStore.getState().subscribeRealtime();
    const atStart = countVisibilityListeners(add, remove);

    for (let round = 0; round < 5; round += 1) {
      channels[channels.length - 1].cb!('TIMED_OUT');
      vi.advanceTimersByTime(60_000);
      channels[channels.length - 1].cb!('SUBSCRIBED');
    }
    expect(countVisibilityListeners(add, remove)).toBe(atStart);

    unsubscribe();
    unsubscribe = null;
    expect(countVisibilityListeners(add, remove), 'отписка снимает и слушателей').toBe(0);
  });

  it('статусы устаревшего канала не трогают признак связи', () => {
    unsubscribe = useErpStore.getState().subscribeRealtime();
    channels[0].cb!('CHANNEL_ERROR');
    vi.advanceTimersByTime(RECONNECT_STEPS_MS[0]);
    channels[1].cb!('SUBSCRIBED');
    expect(useErpStore.getState().realtimeLive).toBe(true);

    // Запоздалая ошибка от закрытого канала — не наша связь
    channels[0].cb!('CHANNEL_ERROR');
    expect(useErpStore.getState().realtimeLive).toBe(true);
    vi.advanceTimersByTime(10 * 60_000);
    expect(channels).toHaveLength(2);
  });

  it('SUBSCRIBED от устаревшего канала не перечитывает данные', async () => {
    const loadAll = vi.fn().mockResolvedValue(undefined);
    useErpStore.setState({ loadAll });
    unsubscribe = useErpStore.getState().subscribeRealtime();
    channels[0].cb!('CHANNEL_ERROR');
    vi.advanceTimersByTime(RECONNECT_STEPS_MS[0]);
    channels[1].cb!('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(0);
    expect(loadAll).toHaveBeenCalledTimes(1);

    useErpStore.setState({ realtimeLive: false });
    channels[0].cb!('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(0);
    expect(loadAll).toHaveBeenCalledTimes(1);
  });

  it('отписка во время ожидания переподключения не оставляет таймера', () => {
    unsubscribe = useErpStore.getState().subscribeRealtime();
    channels[0].cb!('CHANNEL_ERROR');
    unsubscribe();
    unsubscribe = null;
    vi.advanceTimersByTime(10 * 60_000);
    expect(channels, 'после отписки канал пересоздаваться не должен').toHaveLength(1);
  });
});
