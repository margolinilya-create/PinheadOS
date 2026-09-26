/**
 * Помощники авторизации, вынесенные из `useAuthStore` 26.09 (ратчет размера
 * файла): адрес возврата из письма и распознавание двух отказов GoTrue.
 */

/**
 * Куда вернуть человека по ссылке из письма — в то приложение, откуда он
 * регистрировался. Без этого адрес берётся из Site URL проекта, а там может
 * стоять чей-то `localhost`, и ссылка уводит в никуда.
 */
export function appOrigin(): string | undefined {
  return typeof window !== 'undefined' ? window.location.origin : undefined;
}

/**
 * Адрес уже заведён.
 *
 * Для приглашения это ТУПИК, а не обычная ошибка формы: `signUp` вторую учётную
 * запись на существующий адрес не создаёт, поэтому ссылка не сработает никогда,
 * сколько её ни открывай. На проде так и вышло — девять попыток подряд с одним
 * и тем же `422 user_already_exists`, потому что экран показывал сухое
 * «Пользователь уже зарегистрирован» и не говорил, куда идти.
 */
export function isAlreadyRegistered(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'user_already_exists' || error.message === 'User already registered';
}

/** Отказ входа именно из-за неподтверждённого адреса, а не из-за пароля */
export function isEmailNotConfirmed(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'email_not_confirmed' || error.message === 'Email not confirmed';
}
