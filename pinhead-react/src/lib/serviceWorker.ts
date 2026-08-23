/**
 * Клиентская половина service worker'а — регистрация и аварийный выключатель.
 * Сам worker и объяснение стратегий — в `public/sw.js`.
 */

export const SW_URL = '/sw.js';

/** Префикс наших кешей: чужие в этом origin трогать нельзя */
const CACHE_PREFIX = 'pinhead-';

/**
 * Аварийный выключатель `?sw=off`.
 *
 * Worker живёт на устройстве и переживает выкатки: сломанный (или просто
 * ненужный) он выключается только с самого устройства. До парка цеховых
 * планшетов руками не дотянуться, поэтому выключатель — часть адреса,
 * который можно продиктовать по телефону. Сам worker этот адрес пропускает
 * в сеть мимо кеша, поэтому страница гарантированно загрузится свежей.
 */
export function isKillSwitch(search: string): boolean {
  try {
    return new URLSearchParams(search).get('sw') === 'off';
  } catch {
    return false;
  }
}

/** Снять регистрацию и стереть наши кеши. Молча: это аварийный путь */
export async function disableServiceWorker(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // Приватный режим, запрет в политике браузера — выключать нечего
  }
  try {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith(CACHE_PREFIX))
      .map((n) => caches.delete(n)));
  } catch {
    // То же самое: отсутствие Cache Storage не повод ронять запуск
  }
}

/**
 * Поставить worker. Зовётся из `main.jsx` один раз.
 *
 * ТОЛЬКО В СОБРАННОМ ПРИЛОЖЕНИИ. В `npm run dev` модули отдаёт Vite по своим
 * адресам и с горячей заменой; worker, кеширующий их, ломал бы разработку,
 * а e2e гоняется против dev-сервера — то есть существующие спеки он
 * не затрагивает вовсе. Отсюда же следствие: у него НЕТ покрытия по
 * умолчанию, и ему написан свой спек против `vite preview`.
 *
 * Регистрация отложена до `load`: она соревнуется за сеть с чанками первого
 * экрана, а нужна не сейчас, а при следующем открытии.
 */
export function setupServiceWorker(enabled: boolean = import.meta.env.PROD): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Выключатель проверяется ПЕРВЫМ и работает независимо от `enabled`:
  // выключать приходится именно то, что уже стоит на устройстве
  if (typeof window !== 'undefined' && isKillSwitch(window.location.search)) {
    void disableServiceWorker();
    return;
  }

  if (!enabled) return;

  // `once`: регистрация нужна ровно один раз за жизнь страницы. Без него
  // слушатель остаётся висеть, а `load` в принципе может прийти повторно
  // (bfcache, ручная отправка события) — и мы регистрировали бы worker снова
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SW_URL).catch(() => {
      // Отказ регистрации — не поломка приложения: без worker'а всё работает
      // ровно как до него, просто без офлайн-открытия
    });
  }, { once: true });
}
