/**
 * Действия заказа v4 (веха 2): переход статуса, проверка запуска, оплата.
 *
 * Статус, оплата и связь с заказом ERP меняются ТОЛЬКО этими RPC
 * (миграция 20261017062110_order_v4_rights, `security definer`, свой гейт):
 * прямую запись этих колонок отклоняет страж `orders` (42501). Права —
 * на сервере; клиент только передаёт намерение и показывает ответ.
 *
 * Ошибка Supabase → `toast.error` с текстом сервера (он русский) и `null`
 * (правило проекта). `launchCheck` невыполненное условие отдаёт ОТВЕТОМ
 * `{ ok: false, reason }`, а не ошибкой: показ причины — дело экрана.
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
import type { PaidKind, SalesOrderStatus } from '../model/types';

/** Цели перехода — белый список `order_v4_transition` */
export const TRANSITION_TARGETS = ['ready_to_launch', 'draft', 'production', 'done', 'archived'] as const;
export type TransitionTarget = (typeof TRANSITION_TARGETS)[number];

export interface TransitionResult {
  id: string;
  status: SalesOrderStatus;
  erp_order_id: string | null;
}

export type LaunchCheckResult =
  | { ok: true; already: boolean; erp_order_id?: string; launch_started_at?: string }
  | { ok: false; reason: string };

export interface PaymentResult {
  id: string;
  paid_at: string | null;
  paid_kind: PaidKind | null;
  paid_override_reason: string | null;
}

interface RpcError {
  message?: string | null;
}

/** Вызов RPC: ошибка или отказ сети — тост и `null` */
async function call<T>(fn: string, args: Record<string, unknown>, fallback: string): Promise<T | null> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      console.error(fn, error);
      toast.error(translateSupabaseError((error as RpcError).message) || fallback);
      return null;
    }
    return data as T;
  } catch (e) {
    console.error(fn, e);
    toast.error(`${fallback}: ${networkFailureMessage(e)}`);
    return null;
  }
}

/** Переход статуса заказа v4. Причина обязательна для «Вернуть менеджеру» */
export function transitionOrder(
  id: string,
  to: TransitionTarget,
  reason?: string,
): Promise<TransitionResult | null> {
  return call<TransitionResult>(
    'order_v4_transition',
    { p_id: id, p_to: to, p_reason: reason ?? null },
    'Не удалось сменить статус заказа',
  );
}

/** Проверка перед созданием заказа ERP: ставит метку начала запуска */
export function launchCheck(id: string): Promise<LaunchCheckResult | null> {
  return call<LaunchCheckResult>('order_v4_launch_check', { p_id: id }, 'Не удалось проверить запуск');
}

/**
 * Отметка оплаты: `kind = null` снимает отметку. Причина «запуск без оплаты»
 * (`overrideReason`) — только руководитель; его вызов с `kind = null` и без
 * причины снимает и отметку, и причину.
 */
export function setPayment(
  id: string,
  kind: PaidKind | null,
  overrideReason?: string,
): Promise<PaymentResult | null> {
  return call<PaymentResult>(
    'order_v4_set_payment',
    { p_id: id, p_kind: kind, p_override_reason: overrideReason ?? null },
    'Не удалось отметить оплату',
  );
}
