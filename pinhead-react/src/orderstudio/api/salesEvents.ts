/**
 * Журнал заказа v4 (`order_events`, миграция B) — только чтение (веха 6+7).
 *
 * Пишут журнал только RPC переходов и оплаты; клиенту RLS даёт SELECT через
 * родителя (виден заказ — видны его события). Здесь два вопроса экранов:
 * - `lastReturn` — почему заказ вернули менеджеру (плашка над вкладками,
 *   пока заказ не отправлен снова, решение 32);
 * - `lastOverride` — кто и почему разрешил запуск без оплаты (оплата
 *   в режиме чтения и на «К запуску», К16).
 *
 * Имя автора события — из `erp_employees.full_name` по `profile_id`:
 * `profiles` чужие строки продавцу не показывает (`profiles_select` — свой
 * или `is_admin()`), а `erp_employees` читает любой одобренный (`erp_is_member()`).
 * Нет строки сотрудника — «сотрудник».
 *
 * Ошибка Supabase → `toast.error` и `null` (правило проекта).
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';

export interface OrderEventNote {
  reason: string;
  actorName: string;
  /** Время события (`order_events.at`) */
  at: string;
}

/** Имя, когда сотрудника ERP с этим профилем нет */
export const UNKNOWN_ACTOR = 'сотрудник';

interface EventRow {
  reason: string | null;
  actor: string | null;
  at: string;
}

async function actorName(actor: string | null): Promise<string | null> {
  if (!actor) return UNKNOWN_ACTOR;
  const { data, error } = await supabase
    .from('erp_employees')
    .select('full_name')
    .eq('profile_id', actor)
    .limit(1);
  if (error) {
    console.error('salesEvents.actorName', error);
    toast.error('Не удалось прочитать журнал заказа');
    return null;
  }
  const name = ((data ?? []) as { full_name?: string | null }[])[0]?.full_name?.trim();
  return name || UNKNOWN_ACTOR;
}

async function toNote(row: EventRow | undefined): Promise<OrderEventNote | null> {
  if (!row || !row.reason) return null;
  const name = await actorName(row.actor);
  return name === null ? null : { reason: row.reason, actorName: name, at: row.at };
}

/** Последний возврат менеджеру (`ready_to_launch → draft`) с причиной; нет — `null` */
export async function lastReturn(orderId: string): Promise<OrderEventNote | null> {
  const { data, error } = await supabase
    .from('order_events')
    .select('reason, actor, at')
    .eq('order_id', orderId)
    .eq('kind', 'status')
    .eq('from_status', 'ready_to_launch')
    .eq('to_status', 'draft')
    .order('at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('lastReturn', error);
    toast.error('Не удалось прочитать журнал заказа');
    return null;
  }
  return toNote(((data ?? []) as EventRow[])[0]);
}

/** Последнее разрешение запуска без оплаты (событие оплаты с причиной); нет — `null` */
export async function lastOverride(orderId: string): Promise<OrderEventNote | null> {
  const { data, error } = await supabase
    .from('order_events')
    .select('reason, actor, at')
    .eq('order_id', orderId)
    .eq('kind', 'payment')
    .not('reason', 'is', null)
    .order('at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('lastOverride', error);
    toast.error('Не удалось прочитать журнал заказа');
    return null;
  }
  return toNote(((data ?? []) as EventRow[])[0]);
}
