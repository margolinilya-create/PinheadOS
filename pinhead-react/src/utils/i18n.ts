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

export function translateSupabaseError(msg: string | null | undefined): string {
  if (!msg) return 'Неизвестная ошибка';
  return ERROR_MAP[msg] || msg;
}
