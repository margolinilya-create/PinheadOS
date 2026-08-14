/**
 * Вызов серверной функции `admin-users` и разбор её ответа.
 *
 * Отдельный модуль, а не строчка в слайсе: у `functions.invoke` своя, НЕ
 * похожая на PostgREST механика ошибок. При не-2xx он кладёт в `error`
 * объект `FunctionsHttpError` с единственным текстом «Edge Function returned
 * a non-2xx status code» — то есть ровно тот плоский шум, который правило
 * проекта запрещает показывать вместо причины. Настоящее сообщение лежит
 * в теле ответа (`error.context`), и достать его нужно ОДИН раз здесь,
 * а не в каждом действии.
 */

import { supabase } from '../../lib/supabase';
import { networkFailureMessage } from '../../utils/i18n';

export interface AdminUsersResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/** Тело ответа функции при отказе — оно и несёт человеческую причину */
async function reasonFrom(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response })?.context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    const message = (body as { error?: unknown })?.error;
    return typeof message === 'string' && message ? message : null;
  } catch {
    // Тело не json (упал сам рантайм функции) — причины в нём нет
    return null;
  }
}

/**
 * Одно действие администрирования. Возвращает тот же вид `{ data, error }`,
 * что и `erpQuery`, поэтому в слайсе работает уже написанная ветка `if (error)`.
 */
export async function adminUsers<T = { ok: true }>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<AdminUsersResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action, ...payload },
    });
    if (error) {
      const reason = await reasonFrom(error);
      return { data: null, error: { message: reason ?? error.message } };
    }
    return { data: data as T, error: null };
  } catch (e) {
    // invoke БРОСАЕТ, когда ответа не было вовсе (нет сети, функция не выкачена)
    return { data: null, error: { message: networkFailureMessage(e) } };
  }
}
