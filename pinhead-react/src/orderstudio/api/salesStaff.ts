/**
 * Сотрудники продаж (веха 3, задача 0; веха 4, задача 0). Миграции E
 * `20261017093841_sales_staff_flag` и F `20261017142210_sales_ms_flag`.
 *
 * Два явных признака профиля: «Ведёт заказы» (`is_sales`) и «МС» (`is_ms`).
 * Ставит руководство продаж: admin, director, rop.
 * Список и переключение — ТОЛЬКО RPC (`security definer`, свой гейт):
 *   · `sales_staff_list()` — политика `profiles_select` пускает к чужим строкам
 *     только `is_admin()`, директор и rop прямым select увидели бы один свой профиль;
 *   · `sales_set_staff(uuid, text, boolean)` — вид признака `'sales'` или `'ms'`;
 *     прямую запись признаков отклоняет страж `profiles_sales_guard` (42501)
 *     даже у админа.
 *
 * Ошибка Supabase → `toast.error` с текстом сервера (он русский) и `null`/`false`.
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
import type { UserRole } from '../../types/auth';

/** Вид признака — ветка `sales_set_staff` */
export type SalesStaffKind = 'sales' | 'ms';

export interface SalesStaffRow {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  approved: boolean;
  is_sales: boolean;
  is_ms: boolean;
}

interface RpcError {
  message?: string | null;
}

/** Все профили с признаками (активные первыми); ошибка — тост и `null` */
export async function fetchSalesStaff(): Promise<SalesStaffRow[] | null> {
  const fallback = 'Не удалось загрузить список сотрудников';
  try {
    const { data, error } = await supabase.rpc('sales_staff_list');
    if (error) {
      console.error('sales_staff_list', error);
      toast.error(translateSupabaseError((error as RpcError).message) || fallback);
      return null;
    }
    // Признак — только `true` или `false`: строка без колонки — не отмечен
    return ((data ?? []) as SalesStaffRow[]).map((r) => ({
      ...r,
      is_sales: r.is_sales === true,
      is_ms: r.is_ms === true,
    }));
  } catch (e) {
    console.error('sales_staff_list', e);
    toast.error(`${fallback}: ${networkFailureMessage(e)}`);
    return null;
  }
}

/** Поставить или снять признак вида `kind`; `true` — сервер принял */
export async function setSalesStaff(id: string, kind: SalesStaffKind, on: boolean): Promise<boolean> {
  const fallback = 'Не удалось сохранить признак сотрудника продаж';
  try {
    const { error } = await supabase.rpc('sales_set_staff', { p_profile: id, p_kind: kind, p_on: on });
    if (error) {
      console.error('sales_set_staff', error);
      toast.error(translateSupabaseError((error as RpcError).message) || fallback);
      return false;
    }
    return true;
  } catch (e) {
    console.error('sales_set_staff', e);
    toast.error(`${fallback}: ${networkFailureMessage(e)}`);
    return false;
  }
}
