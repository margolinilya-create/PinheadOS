import { expect, type Page } from '@playwright/test';
import { DEV_PROFILES, DEV_PROFILE_KEY, type DevProfileName } from '../../src/store/devProfiles';
import type { V4Caller } from '../support/mock/orderV4Rpc';

/**
 * «Смены» обхода (веха 8, задача 9, К12): живой сотрудник проходит свой день
 * на моке. Профиль выбирается при ЗАГРУЗКЕ — ключом `pinhead_dev_profile`
 * (`src/store/devProfiles.ts`), а не подменой стора после неё: так F5 честный,
 * и оболочка выбирается по профилю ровно как у человека после входа.
 *
 * Каждый шаг — утверждение СЛЕДУЮЩЕГО действия по роли («после „Отправить
 * в работу“ видна …»); снимок `test-results/walk/<роль>/NN-<шаг>.png` —
 * дополнительно, для глаз агента `pinhead-qa`. Спека, которая только снимает,
 * зелена на сломанном коде.
 */

export const ORDER_NAV = 'Разделы заказа';
export const ERP_HOME = 'Обзор производства';

/** Профиль загрузки: ставится до первого скрипта страницы на каждый переход и F5 */
export async function asProfile(page: Page, name: DevProfileName): Promise<void> {
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  }, [DEV_PROFILE_KEY, name] as const);
}

/** Тот же человек — вызывающий RPC мока (у мока свой «кто зовёт») */
export function callerOf(name: DevProfileName): V4Caller {
  const u = DEV_PROFILES[name];
  return { id: u.id, name: u.name, role: u.role, is_sales: u.is_sales, is_ms: u.is_ms };
}

/** Журнал смены: шаг N — снимок для агента; утверждения делает сама спека */
export function walkLog(page: Page, role: string) {
  let n = 0;
  return async (step: string) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${step}.png`;
    await page.mouse.move(2000, 2000);
    const width = page.viewportSize()?.width ?? 1280;
    await page.screenshot({ path: `test-results/walk/${role}-${width}/${file}` });
  };
}

/** Раздел «Оформление заказа» открыт: меню раздела на месте */
export async function inOrderSection(page: Page) {
  await expect(page.getByRole('navigation', { name: ORDER_NAV })).toBeVisible();
}

/** Раздел «Производство»: меню раздела заказа нет, обзор производства на месте */
export async function inProduction(page: Page) {
  await expect(page.getByRole('heading', { name: ERP_HOME })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: ORDER_NAV })).toHaveCount(0);
}
