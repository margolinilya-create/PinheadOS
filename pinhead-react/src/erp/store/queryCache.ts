/**
 * Минимальный кэш запросов: дедупликация, stale-while-revalidate, инвалидация.
 *
 * Почему не TanStack Query. Правило проекта — не добавлять зависимости без
 * обсуждения, а нужное здесь умещается в семьдесят строк: у ERP один стор,
 * данные живут в нём, и полноценный клиент-кэш дублировал бы этот стор
 * вторым источником правды. Задачи ровно три:
 *
 *   1. ДЕДУПЛИКАЦИЯ. Карточка заказа монтируется дважды (страница и боковой
 *      Drawer подключены к одному хуку), StrictMode в dev вызывает эффекты
 *      парой — без дедупликации это два одинаковых запроса подряд.
 *   2. STALE-WHILE-REVALIDATE. Вернулись на заказ, который смотрели минуту
 *      назад: показать сразу, обновить в фоне. Пустой экран со скелетоном
 *      на уже виденных данных — худшее, что можно сделать.
 *   3. ИНВАЛИДАЦИЯ. Написал комментарий — пакет заказа устарел.
 *
 * Чего здесь НЕТ намеренно: отмены запроса при уходе с роута. `supabase-js`
 * не принимает AbortSignal, а рвать ответ на уровне промиса бессмысленно —
 * запрос всё равно уйдёт и вернётся. Защита от «поздний ответ перезаписал
 * текущий экран» решается alive-гардом у вызывающего, и она уже есть.
 */

interface Entry<T> {
  value: T;
  /** Метка времени последнего успешного ответа */
  at: number;
}

const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** Сколько ответ считается свежим (мс). Дольше — отдаём и обновляем в фоне */
export const DEFAULT_TTL_MS = 30_000;

/** Часы вынесены, чтобы тесты не зависели от реального времени */
let now = () => Date.now();
export function _setClock(fn: () => number): void { now = fn; }

export interface CachedOptions<T> {
  /** Свежесть; 0 — всегда перезапрашивать (дедупликация остаётся) */
  ttlMs?: number;
  /** Вызывается, когда фоновое обновление принесло новое значение */
  onRevalidated?: (value: T) => void;
}

/**
 * Запрос под ключом. Свежий ответ отдаётся из кэша; протухший — отдаётся
 * СРАЗУ, а обновление идёт фоном (результат придёт в `onRevalidated`).
 * Параллельные вызовы с тем же ключом делят один сетевой запрос.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  { ttlMs = DEFAULT_TTL_MS, onRevalidated }: CachedOptions<T> = {},
): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;
  const fresh = hit && now() - hit.at < ttlMs;
  if (hit && fresh) return hit.value;

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) {
    // Есть незавершённый запрос: протухшие данные показываем немедленно,
    // а обновление приедет тем же промисом, что уже летит.
    if (hit) {
      void running.then((v) => onRevalidated?.(v)).catch(() => {});
      return hit.value;
    }
    return running;
  }

  const promise = fetcher()
    .then((value) => {
      cache.set(key, { value, at: now() });
      return value;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, promise);

  if (hit) {
    // Протухло, но есть что показать — не держим экран пустым
    void promise.then((v) => onRevalidated?.(v)).catch(() => {});
    return hit.value;
  }
  return promise;
}

/** Сбросить записи, чей ключ начинается с префикса (инвалидация после мутации) */
export function invalidate(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Полная очистка — при выходе из системы и в тестах */
export function clearQueryCache(): void {
  cache.clear();
  inflight.clear();
}

/** Только для тестов: что лежит в кэше */
export function _cacheSize(): number { return cache.size; }
