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
 *
 * Миграция J (веха 6+7, К18–К19): ответы дополнены `updated_at` (и `status`,
 * `sent_at`) — экран кладёт их в стор `applyServer`, иначе следующее
 * сохранение ушло бы со старой версией и получило ложный «изменён в другой
 * вкладке». `transition` принимает `p_expected_updated_at` (отправка) и
 * `p_erp_order_id` (запуск); оба уходят, только если заданы — старая
 * сигнатура B их не знает. Ответ PostgREST «функции нет» (`PGRST202`/404:
 * вкладка новее сервера или J откатили) — понятный текст, а не английский.
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
  /** J: версия строки после перехода; нет — сервер старше J (стор перечитает заказ) */
  updated_at?: string;
  sent_at?: string | null;
}

/** J: `launched` — у заказа уже стоит `erp_order_id` (заказ ERP привязан) */
export type LaunchCheckResult =
  | { ok: true; already: boolean; launched: boolean; erp_order_id?: string; launch_started_at?: string; updated_at?: string }
  | { ok: false; reason: string };

export interface PaymentResult {
  id: string;
  paid_at: string | null;
  paid_kind: PaidKind | null;
  paid_override_reason: string | null;
  updated_at?: string;
  status?: SalesOrderStatus;
}

/** Функции с такими аргументами на сервере нет — вкладка новее базы */
export const SERVER_OUTDATED_TEXT = 'Вышло обновление сервера — обновите страницу';

interface RpcError {
  code?: string | null;
  message?: string | null;
}

/** PostgREST не нашёл функцию: `PGRST202` или HTTP 404 */
function isMissingFunction(error: RpcError, status: number | undefined): boolean {
  return error.code === 'PGRST202' || error.code === '404' || status === 404;
}

/**
 * Текст отказа перехода → вид: «изменён в другой вкладке» — `conflict` (та же
 * классификация, что у сохранения: текст J = текст `order_v4_save_full`)
 */
export function transitionFailureKind(message: string | null | undefined): 'conflict' | 'other' {
  return (message ?? '').includes('изменён в другой вкладке') ? 'conflict' : 'other';
}

/** Вызов RPC: ошибка или отказ сети — тост и `null` */
async function call<T>(fn: string, args: Record<string, unknown>, fallback: string): Promise<T | null> {
  try {
    const { data, error, status } = await supabase.rpc(fn, args) as {
      data: unknown; error: RpcError | null; status?: number;
    };
    if (error) {
      console.error(fn, error);
      toast.error(isMissingFunction(error, status)
        ? SERVER_OUTDATED_TEXT
        : translateSupabaseError(error.message) || fallback);
      return null;
    }
    return data as T;
  } catch (e) {
    console.error(fn, e);
    toast.error(`${fallback}: ${networkFailureMessage(e)}`);
    return null;
  }
}

/**
 * Переход статуса заказа v4. Причина обязательна для «Вернуть менеджеру».
 * `expectedUpdatedAt` — версия, которую видел клиент (отправка: сервер
 * отказывает «изменён в другой вкладке»); `erpOrderId` — id, который вернул
 * `createOrder` этого запуска (переход в `production`). Пустые не уходят.
 */
export function transitionOrder(
  id: string,
  to: TransitionTarget,
  reason?: string,
  expectedUpdatedAt?: string | null,
  erpOrderId?: string,
): Promise<TransitionResult | null> {
  return call<TransitionResult>(
    'order_v4_transition',
    {
      p_id: id,
      p_to: to,
      p_reason: reason ?? null,
      ...(expectedUpdatedAt ? { p_expected_updated_at: expectedUpdatedAt } : {}),
      ...(erpOrderId ? { p_erp_order_id: erpOrderId } : {}),
    },
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
