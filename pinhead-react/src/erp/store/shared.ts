/**
 * Инфраструктура ERP-стора: аудит этапов, защита от гонок, тайминги.
 * Вынесено из useErpStore.ts (рефакторинг по плану аудита) — самодостаточный
 * плумбинг без зависимости от ErpOrderFull, чтобы избежать циклических импортов.
 */

import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import { translateSupabaseError } from '../../utils/i18n';
import type { ErpStageEvent } from '../types';

/** Имя действующего пользователя для аудита */
export function currentActor(): string {
  const u = useAuthStore.getState().user;
  return u?.name || u?.email || 'неизвестно';
}

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
