import { describe, expect, it, vi } from 'vitest';
import { isRefreshRequest, REFRESH_TIMEOUT_MS, withRefreshTimeout } from './authFetch';

const REFRESH = 'https://demo.supabase.co/auth/v1/token?grant_type=refresh_token';
const PASSWORD = 'https://demo.supabase.co/auth/v1/token?grant_type=password';
const REST = 'https://demo.supabase.co/rest/v1/erp_orders?select=*';

/** Шпион с сигнатурой `fetch` — иначе у `mock.calls` не видно второго аргумента */
const spyFetch = () => vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'),
);

/**
 * Потолок нужен ровно обновлению токена: оно работает внутри общего лока сессии,
 * и повисшее (уснувшая сеть, спящий ноутбук) делает вкладку неработоспособной
 * целиком — чужой захват через пять секунд забирает лок силой, и дальше каждый
 * запрос падает с `Lock broken by another request with the 'steal' option`.
 *
 * А вот вход и регистрацию рвать нельзя: за медленным ответом там стоит человек,
 * и оборванное действие хуже, чем ожидание.
 */
describe('withRefreshTimeout — потолок только на обновление токена', () => {
  it('обновление токена узнаётся, соседние запросы — нет', () => {
    expect(isRefreshRequest(REFRESH)).toBe(true);
    expect(isRefreshRequest(new URL(REFRESH))).toBe(true);
    expect(isRefreshRequest(new Request(REFRESH))).toBe(true);
    expect(isRefreshRequest(PASSWORD)).toBe(false);
    expect(isRefreshRequest(REST)).toBe(false);
  });

  it('обновлению токена подставляется signal с таймаутом', () => {
    const base = spyFetch();
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    void withRefreshTimeout(base)(REFRESH, { method: 'POST' });

    expect(timeout).toHaveBeenCalledWith(REFRESH_TIMEOUT_MS);
    expect(base.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(base.mock.calls[0][1]?.method).toBe('POST');
    timeout.mockRestore();
  });

  it('вход и обычные запросы уходят как есть', () => {
    const base = spyFetch();
    const wrapped = withRefreshTimeout(base);

    void wrapped(PASSWORD, { method: 'POST' });
    void wrapped(REST);

    expect(base.mock.calls[0][1]?.signal).toBeUndefined();
    expect(base.mock.calls[1][1]).toBeUndefined();
  });

  it('чужой signal не подменяется — вызывающий рвёт запрос по своей причине', () => {
    const base = spyFetch();
    const own = new AbortController().signal;

    void withRefreshTimeout(base)(REFRESH, { signal: own });

    expect(base.mock.calls[0][1]?.signal).toBe(own);
  });

  it('оборванное обновление отдаёт ошибку, а не висит', async () => {
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      },
    ));

    await expect(withRefreshTimeout(base, 10)(REFRESH)).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
