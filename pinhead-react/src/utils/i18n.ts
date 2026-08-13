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
  'Email rate limit exceeded':       'Слишком много писем за час, попробуйте позже',
  'Network request failed':          'Ошибка сети',
  'Failed to fetch':                 'Ошибка соединения',
  'Signups not allowed for this instance': 'Регистрация отключена, обратитесь к администратору',
  'Error sending confirmation email': 'Не удалось отправить письмо с подтверждением. Обратитесь к администратору',
};

/**
 * Сообщения с переменной частью — точки в карте им не хватает.
 *
 * Supabase дописывает в текст число секунд («…only request this after 51
 * seconds»), а к требованию к паролю — точку в конце. Совпадение по полной
 * строке на таких не срабатывает, и человек получал английский текст: именно
 * так выглядит отказ при повторной отправке письма, самый частый на экране
 * подтверждения адреса.
 */
const ERROR_PATTERNS: Array<[RegExp, string]> = [
  [/only request this (?:once every|after)/i, 'Письмо уже отправлено. Повторить можно через минуту'],
  [/password should be at least (\d+) characters/i, 'Пароль должен быть не короче $1 символов'],
  [/email address .* is invalid/i, 'Некорректный формат email'],
];

/**
 * Отказы серверных стражей приходят с техническим префиксом функции
 * («erp_calendar_guard: …»). Показывать его человеку незачем — суть сообщения
 * уже на русском, снимаем только префикс.
 */
const GUARD_PREFIX = /^erp_[a-z_]+:\s*/;

export function translateSupabaseError(msg: string | null | undefined): string {
  if (!msg) return 'Неизвестная ошибка';
  if (ERROR_MAP[msg]) return ERROR_MAP[msg];
  for (const [pattern, ru] of ERROR_PATTERNS) {
    if (pattern.test(msg)) return msg.replace(pattern, ru);
  }
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

export function networkFailureMessage(e: unknown): string {
  const raw = rawReason(e);
  if (NETWORK_SIGNS.test(raw)) return 'нет связи с сервером';
  return raw.trim() || 'нет связи с сервером';
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
