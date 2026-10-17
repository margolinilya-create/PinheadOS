/**
 * Менеджеры продаж (веха 3, задача 0; миграция E `20261017093841_sales_staff_flag`).
 *
 * Продавец — явный признак `profiles.is_sales`, его ставит admin или director.
 * Список и переключение — ТОЛЬКО RPC (`security definer`, свой гейт):
 *   · `sales_staff_list()` — политика `profiles_select` пускает к чужим строкам
 *     только `is_admin()`, директор прямым select увидел бы один свой профиль;
 *   · `sales_set_staff(uuid, boolean)` — прямую запись `is_sales` отклоняет
 *     страж `profiles_sales_guard` (42501) даже у админа.
 *
 * Ошибка Supabase → `toast.error` с текстом сервера (он русский) и `null`/`false`.
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
import type { UserRole } from '../../types/auth';

export interface SalesStaffRow {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  approved: boolean;
  is_sales: boolean;
}

interface RpcError {
  message?: string | null;
}

/** Все профили с признаком `is_sales` (активные первыми); ошибка — тост и `null` */
export async function fetchSalesStaff(): Promise<SalesStaffRow[] | null> {
  const fallback = 'Не удалось загрузить список менеджеров';
  try {
    const { data, error } = await supabase.rpc('sales_staff_list');
    if (error) {
      console.error('sales_staff_list', error);
      toast.error(translateSupabaseError((error as RpcError).message) || fallback);
      return null;
    }
    return (data ?? []) as SalesStaffRow[];
  } catch (e) {
    console.error('sales_staff_list', e);
    toast.error(`${fallback}: ${networkFailureMessage(e)}`);
    return null;
  }
}

/** Поставить или снять признак; `true` — сервер принял */
export async function setSalesStaff(id: string, on: boolean): Promise<boolean> {
  const fallback = 'Не удалось сохранить признак менеджера продаж';
  try {
    const { error } = await supabase.rpc('sales_set_staff', { p_profile: id, p_on: on });
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
