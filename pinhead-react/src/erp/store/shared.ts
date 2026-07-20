/**
 * Инфраструктура ERP-стора: аудит этапов, защита от гонок, тайминги.
 * Вынесено из useErpStore.ts (рефакторинг по плану аудита) — самодостаточный
 * плумбинг без зависимости от ErpOrderFull, чтобы избежать циклических импортов.
 */

import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { ErpStageEvent } from '../types';

/** Имя действующего пользователя для аудита */
export function currentActor(): string {
  const u = useAuthStore.getState().user;
  return u?.name || u?.email || 'неизвестно';
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
/** Debounce последнего fallback — полной перезагрузки loadAll */
export const FULL_RELOAD_DEBOUNCE_MS = 500;
