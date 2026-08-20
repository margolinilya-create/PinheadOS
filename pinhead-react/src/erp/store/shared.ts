/**
 * Инфраструктура ERP-стора: аудит этапов, защита от гонок, тайминги.
 * Вынесено из useErpStore.ts (рефакторинг по плану аудита) — самодостаточный
 * плумбинг без зависимости от ErpOrderFull, чтобы избежать циклических импортов.
 */

import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import { isTransportFailure, networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
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
 *
 * Сюда же попадает перехваченный лок сессии: это тоже сбой ДО отправки — токен
 * доступа берётся под тем самым локом, и запрос не уходил вовсе. Оба случая
 * узнаёт `isTransportFailure`, и она же решает повтор у загрузки файлов.
 */
export async function erpRead<T>(
  run: () => PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<ErpResult<T>> {
  const first = await erpQuery(run);
  if (!isTransportFailure(first.error)) return first;
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

/** Пауза перед повтором загрузки файла, оборвавшейся на сети */
export const UPLOAD_RETRY_MS = 600;

/** Ответ Storage «объект с таким ключом уже есть» */
function alreadyExists(message: string): boolean {
  return /already exists|duplicate/i.test(message);
}

/**
 * Файл ЕСТЬ в бакете?
 *
 * `list` ищет по каталогу с фильтром `search` (это подстрока, поэтому имя
 * сверяем точно). Политика чтения бакета обязательна — без неё проверка
 * молча отвечала бы «файла нет» и превращалась бы в лишний повтор.
 */
async function objectExists(bucket: string, path: string): Promise<boolean> {
  const cut = path.lastIndexOf('/');
  const dir = cut > 0 ? path.slice(0, cut) : '';
  const name = path.slice(cut + 1);
  const { data } = await erpQuery(() => supabase.storage
    .from(bucket)
    .list(dir, { search: name, limit: 100 }));
  return Array.isArray(data) && data.some((o) => o?.name === name);
}

/**
 * Загрузка файла, которая не теряет уже загруженное.
 *
 * Проверено на проде 20.08: менеджер приложил к заказу два ТЗ, интерфейс написал
 * «не загрузилось: Ошибка соединения» у обоих и заблокировал «Создать заказ», —
 * а в Storage ОБА файла лежали. По логам видно почему: preflight ушёл в 12:31,
 * ответ на загрузку пришёл в 12:48. Шестнадцать минут связь не отвечала, браузер
 * успел объявить `fetch` несостоявшимся, а сервер файлы всё-таки принял и записал.
 * Человек в этот момент видит ошибку про файлы, которые на месте, и не может ни
 * создать заказ, ни понять, что происходит.
 *
 * Отсюда три шага, и порядок у них не случайный:
 *   1. `already exists` — это УСПЕХ, а не сбой: ключ содержит `uuid`, выданный
 *      этой же формой, поэтому занять его мог только наш предыдущий заход;
 *   2. сбой без ответа сервера — сначала СПРОСИТЬ бакет. Если файл там, повтор
 *      был бы вторым мегабайтом по той самой связи, которая только что оборвалась;
 *   3. и только потом один повтор, и после него — та же проверка: ответ мог
 *      снова не дойти, а файл снова записаться.
 *
 * Повторяется ТОЛЬКО сбой без ответа сервера. Отказ прав и `InvalidKey` —
 * это решение сервера: повтор их не исправит, а причину спрячет.
 */
export async function uploadResilient(
  bucket: string,
  path: string,
  file: File | Blob,
  options?: { contentType?: string; upsert?: boolean },
): Promise<{ error: { message: string } | null }> {
  const put = () => erpQuery(() => supabase.storage
    .from(bucket)
    // `upsert` всегда: повторный заход перезаписывает СВОЙ же ключ (в нём `uuid`
    // этой формы), а без него второй заход отвечает «уже существует» на файл,
    // который сам же и положил
    .upload(path, file, { ...options, upsert: true }));

  const first = await put();
  if (!first.error) return { error: null };
  if (alreadyExists(first.error.message)) return { error: null };
  if (!isTransportFailure(first.error)) return { error: first.error };

  if (await objectExists(bucket, path)) return { error: null };

  await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_MS));
  const second = await put();
  if (!second.error) return { error: null };
  if (alreadyExists(second.error.message)) return { error: null };
  if (await objectExists(bucket, path)) return { error: null };
  return { error: second.error };
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
