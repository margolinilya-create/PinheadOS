/**
 * Доступ к разделу «Оформление заказа» — минимум, который читает ВХОДНОЙ чанк
 * (`config/shellChoice.ts`, веха 8, К1).
 *
 * Отдельным модулем, а не прямо из `orderNav.ts`: сборщик кладёт модуль
 * в чанк целиком, и импорт `canUseSales` из `orderNav` перенёс бы во вход всё
 * меню и гейты раздела (замер задачи 5: +3428 Б входа без сжатия и
 * оболочка ERP сверх 195 000 Б gzip). Рантайм-импортов здесь нет (сторож —
 * `orderLayoutCss.test.ts`); `orderNav.ts` реэкспортирует всё отсюда.
 */

/** Профиль учётной записи — сколько нужно для доступа и меню */
export interface SalesProfile {
  /** `auth.uid()` — для гейтов «свой заказ» (автор, разделение обязанностей) */
  id?: string | null;
  role?: string | null;
  is_sales?: boolean | null;
  /** МС: запускает заказы в производство (миграция F) */
  is_ms?: boolean | null;
  active?: boolean | null;
  approved?: boolean | null;
}

/** Руководство продаж (`sales_is_lead()`): видят все заказы */
export const LEAD_ROLES = ['admin', 'director', 'rop'];

/** Профиль действующий: активный и одобренный — как в обеих серверных функциях (`is true`) */
export function isLive(p: SalesProfile): boolean {
  return p.active === true && p.approved === true;
}

/**
 * Работает ли человек с заказами v4. Зеркало `sales_is_seller() or
 * sales_is_lead() or sales_is_ms()` (миграции 20261017062110, 20261017093841,
 * 20261017142210): продавец — признак `is_sales`, МС — признак `is_ms` (оба
 * при любой роли), руководство — роль. Должность в ERP и роль `manager`
 * сами по себе доступа не дают.
 */
export function canUseSales(p: SalesProfile | null | undefined): boolean {
  if (!p || !isLive(p)) return false;
  return p.is_sales === true || p.is_ms === true || LEAD_ROLES.includes(p.role ?? '');
}

