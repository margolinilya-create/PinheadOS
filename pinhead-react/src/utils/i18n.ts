// ═══════════════════════════════════════════
// Russian i18n helpers
// ═══════════════════════════════════════════

/**
 * Russian pluralization.
 * @param n count
 * @param one form for 1, 21, 31 (e.g. "заказ")
 * @param few form for 2-4, 22-24 (e.g. "заказа")
 * @param many form for 0, 5-20, 25-30 (e.g. "заказов")
 */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Map common Supabase/Auth error messages to Russian.
 */
const ERROR_MAP: Record<string, string> = {
  'Invalid login credentials':       'Неверный email или пароль',
  'Email not confirmed':             'Email не подтверждён',
  'User already registered':         'Пользователь уже зарегистрирован',
  'Password should be at least 6 characters': 'Пароль должен быть не короче 6 символов',
  'Unable to validate email address: invalid format': 'Некорректный формат email',
  'Email rate limit exceeded':       'Слишком много запросов, попробуйте позже',
  'Network request failed':          'Ошибка сети',
  'Failed to fetch':                 'Ошибка соединения',
};

/**
 * Отказы серверных стражей приходят с техническим префиксом функции
 * («erp_calendar_guard: …»). Показывать его человеку незачем — суть сообщения
 * уже на русском, снимаем только префикс.
 */
const GUARD_PREFIX = /^erp_[a-z_]+:\s*/;

/**
 * Гонка за сессию ВНУТРИ supabase-js, а не отказ сервера и не обрыв связи.
 *
 * Клиент держит сессию под общим для всей вкладки Web Lock (`lock:sb-…-auth-token`),
 * и с версии auth-js 2.98 захват, не дождавшийся своей очереди за 5 секунд,
 * ЗАБИРАЕТ лок силой (`steal: true`). Прежний держатель в этот момент получает
 * `AbortError: Lock broken by another request with the 'steal' option` — и его
 * запрос не уходит вовсе, потому что токен доступа берётся как раз под этим локом.
 *
 * Держателем становится любая затянувшаяся операция авторизации: обновление
 * токена при возвращении на вкладку (`visibilitychange` → `_recoverAndRefresh`),
 * восстановление просроченной сессии при загрузке страницы. Достаточно уснувшей
 * или медленной сети, чтобы она провисела дольше пяти секунд, — а рядом хватает
 * второй вкладки того же приложения, чтобы кража состоялась.
 *
 * Для человека это не сообщение: он видел английский текст браузера («Не удалось
 * загрузить профиль: AbortError: Lock broken by another request with the 'steal'
 * option») и не мог ни понять причину, ни что-то исправить. Запрос при этом
 * ПОВТОРИМ — он не был отправлен.
 */
const AUTH_LOCK_SIGNS = /lock broken by another request|navigator lockmanager lock/i;

/**
 * Сообщение о сорванном локе — ОДНА строка на весь проект.
 *
 * По ней же `erpRead` узнаёт свой случай для повтора, поэтому копия рядом
 * означала бы повтор, который молча перестанет срабатывать при правке текста.
 */
export const AUTH_LOCK_MESSAGE = 'сессия обновлялась в другой вкладке, попробуйте ещё раз';

/**
 * Текст причины у чего угодно: у брошенной ошибки, у строки и у объекта
 * `{ message }`, каким сбой приезжает из `erpQuery` и из `fetchProfile`.
 * Отдельно от `rawReason`: тот намеренно строг — по нему решается «это обрыв
 * связи», и объект без текста не должен объявляться потерей сети.
 */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message?: unknown }).message ?? '');
  }
  return '';
}

/**
 * Сбой из-за перехваченного лока сессии, а не из-за сети или отказа сервера.
 *
 * Причина приезжает в ТРЁХ видах, и узнавать надо все: брошенной ошибкой
 * (`getSession` вне запроса), полем `error` ответа PostgREST — он сам ловит
 * исключение `fetch` и подписывает его именем (`AbortError: Lock broken…`), —
 * и уже переведённой фразой, если её успел обработать `networkFailureMessage`.
 * Проверка, знающая только сырой текст, молча перестала бы срабатывать после
 * перевода: повтор не сделался бы ни разу, а выглядело бы всё рабочим.
 */
export function isAuthLockFailure(e: unknown): boolean {
  const msg = messageOf(e);
  return AUTH_LOCK_SIGNS.test(msg) || msg === AUTH_LOCK_MESSAGE;
}

export function translateSupabaseError(msg: string | null | undefined): string {
  if (!msg) return 'Неизвестная ошибка';
  if (ERROR_MAP[msg]) return ERROR_MAP[msg];
  // Гонка за лок сессии приходит сюда сырым текстом браузера — см. AUTH_LOCK_SIGNS
  if (isAuthLockFailure(msg)) return AUTH_LOCK_MESSAGE;
  return msg.replace(GUARD_PREFIX, '');
}

/**
 * Сбой, при котором ответа сервера НЕ БЫЛО: нет сети, оборвалось соединение, CORS.
 *
 * Браузеры называют это по-своему — `Load failed` в WebKit, `Failed to fetch`
 * в Chromium, — и оба текста внутренние: они не говорят человеку ни что случилось,
 * ни что делать. Именно `Load failed` заказчик и видел россыпью на нескольких
 * экранах сразу, потому что `supabase-js` в этом случае БРОСАЕТ, а не возвращает
 * `error`, и отклонение промиса всплывало глобальным обработчиком как есть.
 */
/** Подписи, по которым браузеры сообщают об обрыве связи */
const NETWORK_SIGNS = /load failed|failed to fetch|networkerror|network request failed/i;

/** Текст самой причины (`String(null)` дал бы «null», поэтому разбираем по типам) */
function rawReason(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === 'string' ? e : '';
}

/** Сообщение об обрыве связи — одно на весь проект, по нему же решается повтор */
export const NETWORK_MESSAGE = 'нет связи с сервером';

export function networkFailureMessage(e: unknown): string {
  const raw = rawReason(e);
  if (NETWORK_SIGNS.test(raw)) return NETWORK_MESSAGE;
  if (AUTH_LOCK_SIGNS.test(raw)) return AUTH_LOCK_MESSAGE;
  return raw.trim() || NETWORK_MESSAGE;
}

/**
 * Сбой, при котором ОТВЕТА СЕРВЕРА НЕ БЫЛО: оборвалась связь или перехватили лок
 * сессии. Отличается от отказа сервера тем, что о судьбе запроса ничего не
 * известно — он мог не уйти вовсе, а мог и выполниться (20.08 загрузка ТЗ
 * «не удалась» у человека и при этом записалась в Storage). Поэтому такой сбой
 * и повторяют, и перепроверяют, а отказ прав или `InvalidKey` — никогда.
 *
 * Причина приезжает и сырым текстом браузера, и уже переведённой: узнаём оба.
 */
export function isTransportFailure(e: unknown): boolean {
  const msg = messageOf(e);
  return NETWORK_SIGNS.test(msg) || msg === NETWORK_MESSAGE || isAuthLockFailure(e);
}

/**
 * Именно СЕТЕВОЙ сбой, а не «сообщения не нашлось».
 *
 * Здесь стояло сравнение с результатом `networkFailureMessage`, а тот отдаёт
 * ту же фразу и как ФОЛБЭК — для причины без текста. Отклонение обычным
 * объектом (`Promise.reject({ code: 'PGRST301' })`) или `Error('')` объявлялось
 * потерей связи, и человек видел «Нет связи с сервером» там, где связь была,
 * а настоящая причина пропадала.
 */
export function isNetworkFailure(e: unknown): boolean {
  return NETWORK_SIGNS.test(rawReason(e));
}
