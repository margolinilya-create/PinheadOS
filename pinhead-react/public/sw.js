/*
 * Service worker: приложение открывается, когда сети нет.
 *
 * ЗАЧЕМ. Планшет в цеху теряет Wi-Fi постоянно, а система его вкладку
 * выгружает. Возврат к выгруженной вкладке — это НАВИГАЦИЯ, и без сети она
 * даёт системную страницу «нет соединения»: приложение «пропало», хотя все
 * 200 кБ кода лежат у человека на диске. Аудит 29.07 это уже фиксировал.
 *
 * ЧЕГО ЭТО НЕ ДАЁТ, и это надо говорить прямо: ОФЛАЙН-РАБОТЫ НЕ БУДЕТ.
 * Данные живут в Supabase, здесь кешируется только КОД. Открытое без сети
 * приложение покажет пустые экраны и полосу «связь потеряна» (`StaleDataBar`).
 * Ответы Supabase не кешируются сознательно: выборка зависит от того, кто
 * вошёл, а на общем цеховом планшете кеш чужой выборки — ровно тот дефект,
 * против которого написаны `resetErpStore()` и `storageClearAll()`.
 *
 * БЕЗ ПРЕДЗАГРУЗКИ (precache). Манифест сборки требует связки со сборщиком
 * и новой зависимости, а выигрыш даёт только на ПЕРВОЙ загрузке — которой
 * сеть нужна в любом случае. Здесь кешируется то, чем реально пользовались.
 *
 * Клиентская половина (регистрация и аварийный выключатель) — в
 * `src/lib/serviceWorker.ts`.
 */

const VERSION = 'v1';
const SHELL_CACHE = `pinhead-shell-${VERSION}`;
const ASSET_CACHE = `pinhead-assets-${VERSION}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE];

/** Оболочка: её отдаём на любую навигацию, когда сети нет */
const SHELL_URL = '/index.html';

/**
 * Сколько ждать сеть на навигации, прежде чем показать закешированную оболочку.
 * Сеть всё равно догружается в фоне и обновляет кеш — ожидание касается только
 * того, что человек увидит СЕЙЧАС. На умирающем цеховом Wi-Fi запрос может
 * висеть до таймаута TCP, то есть десятки секунд.
 */
const NAV_TIMEOUT_MS = 3000;

/**
 * Потолок кеша ассетов. Каждая выкатка добавляет НОВЫЕ имена файлов (в них
 * хеш содержимого), старые никто не удаляет — за полгода это сотни файлов
 * на устройстве. Обрезка FIFO: `cache.keys()` по спецификации отдаёт запросы
 * в порядке вставки, поэтому первые в списке — самые давние.
 */
const ASSET_LIMIT = 150;

/**
 * Что кешируем «сначала из кеша». Оба каталога отдаются с длинным
 * `Cache-Control` (см. `vercel.json`), то есть браузер и так их не
 * перезапрашивает; service worker добавляет к этому ОФЛАЙН-доступ.
 * У `/assets/` в имени есть хеш содержимого, поэтому «первый ответ навсегда»
 * здесь безопасно по построению.
 */
const CACHED_PREFIXES = ['/assets/', '/fonts/'];

self.addEventListener('install', () => {
  /*
   * `skipWaiting()` НЕ зовём.
   *
   * Он заставил бы новый worker встать на место старого немедленно — под
   * УЖЕ ОТКРЫТОЙ вкладкой, которая работает со старыми именами чанков.
   * Дальше первый же ленивый экран запрашивает файл прошлой выкладки, а новый
   * worker его не знает: получилась бы ровно та поломка, которую лечит
   * `lib/appUpdate`, только вызванная нами самими и без выкатки.
   * Новый worker дождётся закрытия всех вкладок — на планшете это происходит
   * при первой же перезагрузке по подсказке «вышло обновление».
   */
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Кеши прошлых версий этого файла (VERSION выше) убираем сами: иначе они
    // остаются на устройстве навсегда, занимая место без единого читателя
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('pinhead-') && !KEEP.includes(n))
      .map((n) => caches.delete(n)));
    /*
     * Берём под управление уже открытые вкладки. На ПЕРВОЙ установке это
     * безопасно (страница работает с текущей выкладкой, и рассинхрону взяться
     * неоткуда), а без этого кеш начал бы наполняться только со второго
     * открытия. У обновлённого worker'а activate и так наступает лишь после
     * закрытия всех прежних вкладок — см. отсутствие skipWaiting выше.
     */
    await self.clients.claim();
  })());
});

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** FIFO-обрезка: удаляем самые давние записи сверх потолка */
async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - ASSET_LIMIT;
  for (let i = 0; i < extra; i += 1) {
    await cache.delete(keys[i]);
  }
}

/**
 * Навигация: сначала сеть, при её молчании — закешированная оболочка.
 *
 * Именно «сначала сеть», а не наоборот: `index.html` и есть указатель на
 * текущие имена чанков, и отданный из кеша он держал бы цех на старой версии.
 */
async function handleNavigate(request) {
  const cache = await caches.open(SHELL_CACHE);

  const fromNetwork = fetch(request)
    .then(async (res) => {
      if (res && res.ok) await cache.put(SHELL_URL, res.clone());
      return res;
    })
    // Отказ сети — это НЕ ошибка здесь, а обычное состояние цеха; обработать
    // его надо на месте, иначе он всплывёт необработанным отклонением промиса
    // после того, как гонку ниже выиграет таймаут
    .catch(() => null);

  const cached = await cache.match(SHELL_URL);
  if (!cached) {
    // Первое в жизни устройства открытие и сразу без сети: показать нечего.
    // Отвечаем понятной страницей, а не пустотой браузера
    const res = await fromNetwork;
    return res || new Response(
      '<!doctype html><meta charset="utf-8">'
      + '<title>Нет соединения</title>'
      + '<body style="font:16px/1.5 system-ui;padding:24px">'
      + '<h1 style="font-size:20px">Нет соединения</h1>'
      + '<p>Приложение ещё ни разу не открывалось на этом устройстве, '
      + 'поэтому показать его без сети нечем. Подключитесь к Wi-Fi '
      + 'и обновите страницу.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  const res = await Promise.race([fromNetwork, wait(NAV_TIMEOUT_MS)]);
  // `wait` отдаёт undefined, отказ сети — null: и то и другое означает
  // «показываем оболочку из кеша»
  return res || cached;
}

/**
 * Открыта ли страница, сделавшая запрос, в аварийном режиме `?sw=off`.
 *
 * Проверять надо КЛИЕНТА, а не сам запрос: выключатель стоит в адресе
 * страницы, а её чанки запрашиваются по своим адресам, без него. Без этой
 * проверки выключатель не работал: `unregister()` снимает регистрацию,
 * но НЕ отбирает управление у уже открытой страницы — worker продолжал
 * обслуживать её ассеты и заводил кеш заново, ровно поверх только что
 * стёртого. Клиент выглядел бы вычищенным, а кеш оставался.
 *
 * Асинхронность здесь ничего не стоит: `respondWith` принимает промис.
 */
async function isKillSwitchClient(clientId) {
  if (!clientId) return false;
  try {
    const client = await self.clients.get(clientId);
    return Boolean(client) && new URL(client.url).searchParams.get('sw') === 'off';
  } catch {
    return false;
  }
}

/** Код и шрифты: сначала кеш. Имена с хешем содержимого, устареть нечему */
async function handleAsset(request, clientId) {
  if (await isKillSwitchClient(clientId)) return fetch(request);

  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  // `basic` — ответ со своего домена: чужие и непрозрачные не кешируем,
  // а 404 не кешируем тем более (иначе откат выкладки не вылечит устройство)
  if (res && res.ok && res.type === 'basic') {
    await cache.put(request, res.clone());
    void trim(cache);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Только GET: POST/PATCH к Supabase кешировать нечем и незачем
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Чужие домены (Supabase, его realtime) не трогаем вовсе
  if (url.origin !== self.location.origin) return;

  // Аварийный выключатель: адрес с `?sw=off` обязан идти в сеть мимо кеша,
  // иначе выключить сломанный worker было бы нечем — до парка планшетов
  // руками не дотянуться (снимает регистрацию `lib/serviceWorker.ts`)
  if (url.searchParams.get('sw') === 'off') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  if (CACHED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    // `clientId` — страница, сделавшая запрос: по нему узнаём аварийный режим
    event.respondWith(handleAsset(request, event.clientId));
  }
});
