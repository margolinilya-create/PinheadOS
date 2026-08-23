import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Офлайн-открытие приложения (проект `offline`, СОБРАННОЕ приложение на 4173).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОЕКТ. Service worker регистрируется только при
 * `import.meta.env.PROD` — против dev-сервера, где гоняется весь остальной
 * e2e, его не существует вовсе. То есть по умолчанию он уехал бы на планшеты
 * без единой проверки, а непроверенный worker на устройстве, к которому не
 * подойти руками, хуже отсутствующего.
 *
 * ЧТО ИМЕННО ПРОВЕРЯЕТСЯ. Что приложение ОТКРЫВАЕТСЯ без сети — не что оно
 * без сети работает: данные живут в Supabase, и офлайн там пусто. В цеху это
 * разница между «программа пропала» и «программа на месте, связи нет».
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

/**
 * Дождаться, пока worker возьмёт страницу под управление, и наполнить кеш.
 *
 * Первый документ и его чанки приходят ДО того, как worker активировался, —
 * они идут мимо него и в кеш не попадают. Поэтому после `ready` нужна
 * перезагрузка: именно она проходит через worker и наполняет кеш. Ровно так
 * это и выглядит на планшете — офлайн застаёт не первое открытие.
 */
async function warmUp(page: Page) {
  await page.goto('/?studio=0');
  await expect(page.getByRole('link', { name: 'На главную ERP' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole('link', { name: 'На главную ERP' })).toBeVisible();
  // Ждём именно КОНТРОЛЬ, а не только активацию: до него запросы страницы
  // идут мимо worker'а, и офлайн-перезагрузка проверяла бы пустой кеш
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

test.describe('Офлайн-открытие', () => {
  test('worker регистрируется в собранном приложении', async ({ page }) => {
    await warmUp(page);
    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.scope ?? null;
    });
    expect(scope, 'worker обязан управлять всем сайтом, а не подпапкой')
      .toMatch(/\/$/);
  });

  test('перезагрузка без сети показывает приложение, а не страницу браузера', async ({
    page, context,
  }) => {
    await warmUp(page);
    await context.setOffline(true);
    await page.reload();

    // Оболочка на месте: до worker'а здесь была системная страница
    // «нет соединения» при полностью скачанном приложении
    await expect(page.getByRole('link', { name: 'На главную ERP' })).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('прямая ссылка вглубь тоже открывается без сети', async ({ page, context }) => {
    // Планшет держат открытым на очереди своего цеха, и возврат к выгруженной
    // вкладке — это навигация по ЕЁ адресу, а не по корню
    await warmUp(page);
    await context.setOffline(true);
    await page.goto('/queue/cutting?studio=0');
    await expect(page.getByRole('link', { name: 'На главную ERP' })).toBeVisible();
  });

  test('аварийный выключатель ?sw=off снимает регистрацию и чистит кеш', async ({ page }) => {
    // Worker живёт на устройстве и переживает выкатки: без выключателя
    // сломанный чинился бы только через «очистить данные сайта» в настройках
    await warmUp(page);
    await page.goto('/?studio=0&sw=off');
    await expect(page.getByRole('link', { name: 'На главную ERP' })).toBeVisible();

    await expect(async () => {
      const state = await page.evaluate(async () => ({
        regs: (await navigator.serviceWorker.getRegistrations()).length,
        caches: (await caches.keys()).filter((n) => n.startsWith('pinhead-')).length,
      }));
      expect(state).toEqual({ regs: 0, caches: 0 });
    }).toPass({ timeout: 10_000 });
  });

  test('ответы Supabase в кеш не попадают', async ({ page }) => {
    // Планшет в цеху общий: кеш чужой выборки — ровно тот дефект, против
    // которого написаны `resetErpStore()` и `storageClearAll()`
    await warmUp(page);
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) {
        const keys = await (await caches.open(name)).keys();
        out.push(...keys.map((r) => r.url));
      }
      return out;
    });
    expect(cached.length, 'кеш пуст — worker не наполнился, проверять нечего')
      .toBeGreaterThan(0);
    for (const url of cached) {
      expect(url, `в кеше чужой адрес: ${url}`).toContain('localhost:4173');
      expect(url).not.toContain('/rest/v1/');
    }
  });
});
