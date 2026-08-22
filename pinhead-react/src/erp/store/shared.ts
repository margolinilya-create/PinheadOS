/**
 * Инфраструктура ERP-стора: аудит этапов, защита от гонок, тайминги.
 * Вынесено из useErpStore.ts (рефакторинг по плану аудита) — самодостаточный
 * плумбинг без зависимости от ErpOrderFull, чтобы избежать циклических импортов.
 */

import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
import { reportError } from '../../lib/errorReport';
import type { ErpStageEvent } from '../types';

/** Имя действующего пользователя для аудита */
export function currentActor(): string {
  const u = useAuthStore.getState().user;
  return u?.name || u?.email || 'неизвестно';
}

/** Ответ, который вернёт `erpQuery` — тот же вид, что у supabase-js */
type ErpResult<T> = { data: T | null; error: { message: string } | null };

/**
 * Сбой ДО ответа сервера читается как обычная ошибка ответа.
 *
 * `supabase-js` возвращает `error`, когда сервер ответил, и БРОСАЕТ, когда ответа
 * не было: нет сети, оборвалось соединение, CORS, клиент не настроен. Проверять
 * только `error` недостаточно, и в сторе это было соблюдено ровно в трёх функциях
 * из шестидесяти. Последствия у каждого экрана свои и одинаково тупиковые:
 * `loadAll` оставляет `loading = true` и `loadError = false` навсегда — а эти
 * флаги общие для десяти экранов, и все они показывают вечный скелетон без
 * кнопки «Повторить»; действие цеха теряет и сообщение, и снятие busy-флага;
 * необработанное отклонение промиса всплывает глобальным обработчиком сырым
 * «Load failed» из WebKit.
 *
 * Обёртка ничего не решает за вызывающего: она превращает бросок в такой же
 * `{ data: null, error }`, какой пришёл бы от сервера, и дальше работает уже
 * написанная ветка `if (error) …` — с `erpError`, откатом и снятием флагов.
 */
export async function erpQuery<T>(
  run: () => PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<ErpResult<T>> {
  try {
    return await run();
  } catch (e) {
    return { data: null, error: { message: networkFailureMessage(e) } };
  }
}

/** Пауза перед повтором чтения, оборвавшегося на сети */
export const READ_RETRY_MS = 800;

/**
 * То же, что `erpQuery`, но с ОДНИМ повтором — и только для ЧТЕНИЯ.
 *
 * Заказчик просил «корректный retry для временных сбоев»: цеховой Wi-Fi роняет
 * запрос на секунду, и человек получает пустой экран там, где данные есть.
 *
 * Два ограничения, без которых повтор вреден:
 *   · повторяется только сбой СЕТИ. Ответ сервера (отказ прав, конфликт) — это
 *     решение, а не помеха: повторять его значит скрывать причину и тратить время;
 *   · повторяется только чтение. Повторить запись — это второй заказ, вторая
 *     приёмка, второе списание брака. Мутации остаются на `erpQuery`.
 */
export async function erpRead<T>(
  run: () => PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<ErpResult<T>> {
  const first = await erpQuery(run);
  const networkFailure = first.error && first.error.message === 'нет связи с сервером';
  if (!networkFailure) return first;
  await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
  return erpQuery(run);
}

// Текст сбоя без ответа сервера живёт в `utils/i18n` — рядом с остальным переводом
// технических сообщений на человеческий, и доступен вне ERP (глобальный обработчик).
export { networkFailureMessage } from '../../utils/i18n';

/**
 * Ошибка действия цеха: что не вышло + ПОЧЕМУ.
 *
 * Раньше все ошибки сводились к «Не удалось обновить этап»: отказ RLS, обрыв
 * сети и конфликт версий выглядели одинаково, а `translateSupabaseError`
 * во всём ERP не использовался ни разу (только в авторизации). Рабочий видел
 * три секунды серого шума, введённые числа откатывались, и он не знал ни
 * причины, ни что делать дальше.
 *
 * Отдельно ловим офлайн: на цеховом Wi-Fi это самая частая причина, и она
 * единственная, где полезен совет «повторите, когда появится сеть».
 */
export function erpError(what: string, error?: { message?: string } | null): false {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) {
    toast.error(`${what}: нет сети. Действие не сохранено — повторите, когда связь появится`);
    // Офлайн наружу НЕ шлём: это состояние сети, а не поломка приложения,
    // и отправлять отчёт всё равно некуда
    return false;
  }
  const reason = error?.message ? translateSupabaseError(error.message) : null;
  toast.error(reason ? `${what}: ${reason}` : what);
  /**
   * Отказ сервера — наружу, к наблюдаемости.
   *
   * Механизм отчётов (`lib/errorReport`) ловил только падения рендера, window
   * и промисов. Но из цеха приезжать будет не белый экран, а именно это:
   * 42501 от стража на действии, которое интерфейс разрешил, конфликт версий,
   * оборванный запрос. Без такого отчёта единственный способ узнать о разошедшемся
   * гейте — звонок от того, у кого «кнопка есть, а действие падает».
   *
   * `reportError` сам дедуплицирует и держит потолок на сессию, поэтому
   * зацикленный экран не забьёт сеть. Отдельный `source` — чтобы отделить
   * отказы сервера от падений интерфейса.
   */
  if (error?.message) {
    reportError(new Error(`${what}: ${error.message}`), 'erp-supabase');
  }
  return false;
}

/**
 * Запись, у которой «0 строк» означает ОТКАЗ, а не успех.
 *
 * RLS на UPDATE и DELETE запрещает через `USING` — то есть отдаёт пустой
 * результат, а не ошибку; исключение бросает только `WITH CHECK`. Клиент,
 * проверяющий один `error`, показывает зелёное «сохранено» там, где в базе
 * не изменилось ничего, а оптимистичная правка остаётся на экране до
 * следующей загрузки. Проект на этом уже ловился дважды: на удалении заказа
 * («Заказ удалён», и он возвращался) и на привязке предварительной закупки.
 *
 * Приём один и тот же — `.select()` и проверка длины, — поэтому он живёт здесь,
 * а не шестью копиями по слайсам: разойдясь, копии дают ровно тот отказ,
 * от которого защищают.
 *
 * `what` — что не вышло, человеческими словами; текст причины добавит `erpError`.
 */
export async function erpWrite<T>(
  what: string,
  run: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<boolean> {
  const { data, error } = await erpQuery(run);
  if (error) return erpError(what, error);
  if ((data ?? []).length === 0) {
    return erpError(what, { message: 'нет прав на это действие или запись изменена другим' });
  }
  return true;
}

/**
 * Убрать за собой файл, который загрузился, но не привязался к заказу.
 *
 * Загрузка вложения — два шага, и второй мог не пройти. Раньше в трёх местах
 * стоял комментарий «удалять его клиенту политика не даёт», и файл оставался
 * в бакете навсегда: платный, никем не учтённый и, пока бакет публичный, ещё
 * и доступный по ссылке. Политика `erp_att_delete_own` (миграция 20260805130000)
 * разрешает автору убрать СВОЙ объект — этого достаточно.
 *
 * Сама уборка не должна ронять сценарий: человеку уже сказали, что привязать
 * не вышло, и «не удалилось то, о чём он не знает» ему ничего не объясняет.
 */
export async function removeOrphanUpload(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.warn('orphan upload not removed:', path, error.message);
}

/** Пауза перед повторной попыткой записи аудита */
export const STAGE_EVENT_RETRY_MS = 1500;

/**
 * Запись события аудита — fire-and-forget, ошибки не блокируют работу.
 * При ошибке — 1 повторная попытка через ~1.5с; если обе неудачны —
 * toast.error + console.warn.
 */
export function logStageEvent(ev: Omit<ErpStageEvent, 'id' | 'created_at' | 'actor'>) {
  const row = { ...ev, actor: currentActor() };
  const attempt = () => supabase.from('erp_stage_events').insert(row);
  void attempt().then(({ error }) => {
    if (!error) return;
    setTimeout(() => {
      void attempt().then(({ error: retryError }) => {
        if (retryError) {
          console.warn('stage event not logged:', retryError.message);
          toast.error('Событие истории не записалось');
        }
      });
    }, STAGE_EVENT_RETRY_MS);
  });
}

/**
 * Защита от race (п.29): ключи сущностей с незавершённой мутацией.
 * Realtime-события по таким ключам не применяются сразу — состояние станет
 * консистентным после ответа сервера (или rollback). Экспорт — для тестов.
 */
export const _pendingMutations = new Set<string>();

/** Выполнить мутацию под pending-ключом (ключ снимается в finally) */
export async function withPending<T>(key: string, fn: () => PromiseLike<T>): Promise<T> {
  _pendingMutations.add(key);
  try {
    return await fn();
  } finally {
    _pendingMutations.delete(key);
  }
}

/** Отсрочка применения realtime-события по сущности с pending-мутацией */
export const REALTIME_DEFER_MS = 1000;
/**
 * Сколько раз пробовать применить отложенное событие. Одной попытки мало:
 * на медленной сети мутация живёт дольше секунды, и событие терялось насовсем.
 * Потолок нужен, чтобы зависший запрос не оставил вечный таймер.
 */
export const REALTIME_DEFER_ATTEMPTS = 10;
/** Debounce последнего fallback — полной перезагрузки loadAll */
export const FULL_RELOAD_DEBOUNCE_MS = 500;
