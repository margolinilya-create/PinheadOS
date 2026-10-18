import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock } from '../support/mockSupabase';
import { asProfile, inProduction, walkLog } from './walkFx';

/**
 * Смена ДИЗАЙНЕРА / ЦЕХА (веха 8, задача 9; сценарий 4 обхода T10): профиль без
 * доступа к разделу заказа открывает `/sales` по ссылке — один раз уходит
 * в «Производство», петли нет; `?studio=1` — та же реакция.
 */

const stored = (page: Page) => page.evaluate(() => localStorage.getItem('pinhead_feature_orderStudio'));

/** Загрузки страницы (событие `load`): уход в «Производство» ровно один, без возврата в раздел */
function loads(page: Page): string[] {
  const seen: string[] = [];
  page.on('load', (p) => { const u = new URL(p.url()); seen.push(u.pathname + u.search); });
  return seen;
}

for (const link of ['/sales', '/sales?studio=1']) {
  test(`@walk дизайнер: ссылка ${link} — один уход в «Производство», петли нет`, async ({ page }) => {
    await asProfile(page, 'designer');
    await installSupabaseMock(page);
    const shot = walkLog(page, 'designer');
    const seen = loads(page);

    await page.goto(link);
    // Ушёл на `/` «Производства»: меню раздела заказа нет, выбор «0» записан
    // (два холодных старта dev-сервера подряд — запас по времени)
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/');
    await inProduction(page);
    expect(await stored(page)).toBe('0');
    await page.waitForTimeout(500);
    // Ровно две загрузки: ссылка и один уход на `/`
    expect(seen, `загрузки: ${seen.join(' → ')}`).toEqual([link, '/']);
    await shot(link.includes('studio') ? 'studio-1' : 'sales');

    // F5 — остаётся в «Производстве», уходов больше нет
    await page.reload();
    await inProduction(page);
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/');
  });
}
