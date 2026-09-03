import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * ВРЕМЕННАЯ диагностика (удалить после разбора): визуальный эталон очереди
 * цеха расходится в CI на 177 пикселей — у ряда вкладок нет градиента
 * подсказки прокрутки, локально он есть. Печатаем геометрию, чтобы понять,
 * почему ряд считает себя непрокручиваемым.
 */
test('диагностика: геометрия ряда вкладок цехов', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-20T09:00:00Z'));
  await installSupabaseMock(page);
  await page.goto('/queue/cutting?studio=0');
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const row = document.querySelector('[role="tablist"][aria-label="Выбор цеха"]');
    const tabs = row ? [...row.children] : [];
    return {
      found: Boolean(row),
      scrollWidth: row?.scrollWidth,
      clientWidth: row?.clientWidth,
      scrollLeft: row?.scrollLeft,
      tabCount: tabs.length,
      widths: tabs.map((t) => Math.round(t.getBoundingClientRect().width)),
      font: row ? getComputedStyle(row.firstElementChild!).fontFamily : null,
      fadeR: document.querySelectorAll('[class*="deptTabsFadeR"]').length,
      fadeL: document.querySelectorAll('[class*="deptTabsFadeL"]').length,
      dpr: window.devicePixelRatio,
      fontsStatus: document.fonts.status,
    };
  });
  console.log('ДИАГНОСТИКА ' + JSON.stringify(info));
});
