/**
 * Инфраструктура ERP-стора: аудит этапов, защита от гонок, тайминги.
 * Вынесено из useErpStore.ts (рефакторинг по плану аудита) — самодостаточный
 * плумбинг без зависимости от ErpOrderFull, чтобы избежать циклических импортов.
 */

import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
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
    return false;
  }
  const reason = error?.message ? translateSupabaseError(error.message) : null;
  toast.error(reason ? `${what}: ${reason}` : what);
  return false;
}

/**
 * Отказ RLS на UPDATE и DELETE — это «затронуто 0 строк», а НЕ исключение.
 *
 * Исключение бросает только `WITH CHECK`; запрет через `USING` просто не
 * находит строк, и PostgREST отвечает успехом с пустым телом. Клиент,
 * проверяющий один `error`, показывает зелёное «сохранено», оставляет
 * оптимистичный патч на экране — а значение возвращается при следующей
 * загрузке. Так молча не работали правка справочников у директора
 * и закрытие складской задачи у диспетчера: рядом стоящее «Добавить»
 * падало громко (его ловит `WITH CHECK`), и человек делал вывод
 * «добавление сломано, а правка работает».
 *
 * Поэтому запись идёт с `.select(...)`, а пустой ответ разбирается ЗДЕСЬ —
 * чтобы формулировка «почему не сохранилось» была одна на весь раздел.
 *
 * @returns `true`, если сервер отказал (строк не затронуто)
 */
export function rlsRefused(rows: unknown[] | null | undefined): boolean {
  return !rows || rows.length === 0;
}

/** Сообщение об отказе прав на записи, которых сервер не отдал */
export function erpRefused(what: string, who = 'у вашей роли нет прав на это действие'): false {
  toast.error(`${what}: ${who}`);
  return false;
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
 * Отсюда и `erpQuery`: голый вызов при обрыве связи ОТКЛОНЯЛСЯ, и отклонение
 * всплывало наружу — `uploadOrderPreview`/`uploadOrderAttachment` падали
 * вместо честного `return false`.
 */
export async function removeOrphanUpload(bucket: string, path: string): Promise<void> {
  const { error } = await erpQuery(() => supabase.storage.from(bucket).remove([path]));
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
  /*
   * Попытка идёт через `erpQuery`, а не голым запросом.
   *
   * Здесь стоял `void attempt().then(({ error }) => …)` без ветки отказа
   * промиса. По правилу раздела supabase-js БРОСАЕТ, когда ответа не было
   * (нет сети, CORS), — то есть при обрыве связи сразу после успешного
   * действия цеха этот промис отклонялся: ретрай не запускался, тост
   * «Событие истории не записалось» не показывался, а в консоль улетал
   * unhandled rejection. Срабатывало после КАЖДОГО действия цеха, если сеть
   * отвалилась сразу после мутации, — то есть именно тогда, когда запись
   * в историю и нужна.
   *
   * `erpQuery` превращает бросок в такой же `{ data: null, error }`, какой
   * пришёл бы от сервера, и ниже работает уже написанная ветка `if (error)`.
   */
  const attempt = () => erpQuery(() => supabase.from('erp_stage_events').insert(row));
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
