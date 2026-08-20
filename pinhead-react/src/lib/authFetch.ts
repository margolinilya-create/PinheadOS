/**
 * Обновление токена не имеет права висеть вечно.
 *
 * `supabase-js` держит сессию под общим Web Lock, и обновление токена работает
 * ВНУТРИ него: при загрузке страницы с просроченной сессией и при каждом
 * возвращении на вкладку (`visibilitychange`). Пока запрос не ответил, лок занят,
 * а собственного таймаута у этого запроса нет — уснувшая вместе с ноутбуком сеть
 * оставляет его висеть неограниченно долго.
 *
 * Дальше вкладка становится неработоспособной целиком: с версии auth-js 2.98
 * чужой захват, прождавший пять секунд, забирает лок силой (`steal: true`),
 * прежний держатель получает `AbortError: Lock broken by another request with
 * the 'steal' option`, и КАЖДЫЙ следующий запрос падает с той же ошибкой мгновенно —
 * он встаёт в очередь за уже сорванной операцией. Так вход и заканчивался
 * россыпью красных полос при полностью исправном сервере (в логах Supabase
 * за 20.08 — 200 на каждом запросе входа).
 *
 * Оборванное обновление токена ничего не теряет: его повторит следующий тик
 * автообновления или ближайший запрос. Поэтому таймаут стоит ТОЛЬКО на нём —
 * вход, регистрация и смена пароля остаются без ограничения, там за медленным
 * ответом стоит человек, и оборвать его действие хуже, чем подождать.
 */
export const REFRESH_TIMEOUT_MS = 10_000;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Запрос обновления токена — единственный, который мы ограничиваем по времени */
export function isRefreshRequest(input: RequestInfo | URL): boolean {
  const url = requestUrl(input);
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token');
}

/**
 * `fetch` для клиента Supabase: обычный, но с потолком на обновление токена.
 *
 * Базовая реализация принимается параметром ради тестов — подменять глобальный
 * `fetch` в них значит проверять мок вместо правила.
 */
export function withRefreshTimeout(
  baseFetch: typeof fetch = (...args) => fetch(...args),
  timeoutMs: number = REFRESH_TIMEOUT_MS,
): typeof fetch {
  return (input, init) => {
    // Свой `signal` не подменяем: у вызывающего есть причина, по которой он рвёт
    // запрос сам, и наш таймаут отменил бы её молча
    if (!isRefreshRequest(input) || init?.signal || typeof AbortSignal?.timeout !== 'function') {
      return baseFetch(input, init);
    }
    return baseFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  };
}
