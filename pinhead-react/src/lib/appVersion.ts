import { useAppUpdateStore } from '../store/useAppUpdateStore';

/**
 * Проверка «вышло обновление» ЗАРАНЕЕ — до первой сломанной кнопки.
 *
 * ЗАЧЕМ. Вкладку в цеху держат открытой сутками. Выкатка меняет имена чанков,
 * и до 27.09 вкладка узнавала об этом единственным способом — первым
 * неудачным ленивым импортом: человек нажимал «Новый заказ» и получал ошибку
 * на ровном месте. `lib/appUpdate` научил показывать в этот момент понятную
 * подсказку вместо сырого текста, но сам момент остался: ошибка, потом
 * подсказка. Здесь подсказка приходит ДО ошибки.
 *
 * КАК. Сборка зашивает в код маркер (`__BUILD_ID__`, см. `vite.config.js`)
 * и кладёт его же в `dist/version.json`. Вкладка читает файл при возврате
 * на экран и раз в несколько минут; маркеры разошлись — на сервере лежит
 * другая сборка, показываем плашку (`components/shared/UpdateBanner`).
 *
 * ЧЕГО НЕ ДЕЛАЕМ. Не перезагружаем сами (планшет — устройство ввода, в форме
 * может быть набранное) и не считаем отказ сети признаком чего-либо: нет
 * ответа или пришёл не JSON — значит, не знаем, и молчим. Файл лежит вне
 * `/assets/`, поэтому service worker его не кеширует, а `no-store` не даёт
 * сделать это браузеру.
 */
export const VERSION_URL = '/version.json';

/** Как часто спрашивать сервер, пока вкладка на экране */
export const CHECK_INTERVAL_MS = 5 * 60_000;

/** Маркер сборки, в которой работает эта вкладка */
export const CURRENT_BUILD: string = __BUILD_ID__;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Маркер выложенной сборки; null — не узнали (сеть, не JSON, нет поля) */
export async function fetchDeployedBuild(fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const build = (data as { build?: unknown } | null)?.build;
    return typeof build === 'string' && build ? build : null;
  } catch {
    return null;
  }
}

/**
 * Другая ли сборка на сервере. Оба маркера обязаны быть известны: пустой
 * текущий (сборка без `define`) или неизвестный выложенный — это «не знаем»,
 * а не «обновление», иначе плашка висела бы на каждом отказе сети.
 */
export function isNewerBuild(deployed: string | null, current: string = CURRENT_BUILD): boolean {
  return Boolean(deployed) && Boolean(current) && deployed !== current;
}

interface WatchOptions {
  /** По умолчанию — только собранное приложение: в dev маркер меняется каждым запуском */
  enabled?: boolean;
  intervalMs?: number;
  onUpdate?: () => void;
  fetchImpl?: FetchLike;
  current?: string;
}

/**
 * Запустить наблюдение. Возвращает остановку.
 *
 * Проверка идёт при возврате вкладки на экран (`visibilitychange`, как
 * и resync realtime — `focus` не слушаем по той же причине: он приходит
 * вместе) и по таймеру. Найденное обновление останавливает наблюдение:
 * второй раз сообщать нечего.
 */
export function startVersionWatch({
  enabled = import.meta.env.PROD,
  intervalMs = CHECK_INTERVAL_MS,
  onUpdate = () => useAppUpdateStore.getState().markAvailable(),
  fetchImpl = fetch,
  current = CURRENT_BUILD,
}: WatchOptions = {}): () => void {
  if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  let stopped = false;
  let inFlight = false;

  const stop = () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };

  const check = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const deployed = await fetchDeployedBuild(fetchImpl);
      if (!stopped && isNewerBuild(deployed, current)) {
        stop();
        onUpdate();
      }
    } finally {
      inFlight = false;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };

  const timer = setInterval(() => {
    // В фоне не спрашиваем: ответ там никому не показать, а планшет экономит батарею
    if (document.visibilityState === 'visible') void check();
  }, intervalMs);
  document.addEventListener('visibilitychange', onVisible);

  return stop;
}
