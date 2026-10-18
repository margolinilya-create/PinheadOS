import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Аварийный выключатель раздела «Оформление заказа» (веха 8, задача 5, К1):
 * сборка с `VITE_FEATURE_ORDER_STUDIO=0` (проект `killswitch`, порт 4174,
 * только в CI или `E2E_KILLSWITCH=1`). Выключатель — правило 1 выбора оболочки:
 * его не обходят ни `?studio=1` (ссылки в закладках и письмах), ни записанный
 * выбор устройства. Dev-автологин здесь — admin; продавец с выключателем
 * проверяется в `App.test.jsx` (подмена профиля в preview-сборке недоступна).
 */

const ERP_HOME = 'Обзор производства';

for (const [name, path, stored] of [
  ['?studio=1', '/sales?studio=1', null],
  ['записанный «1»', '/', '1'],
  ['путь раздела /sales/x с «1»', '/sales/x', '1'],
] as const) {
  test(`выключатель «0»: ${name} — «Производство»`, async ({ page }) => {
    await installSupabaseMock(page);
    if (stored) await page.addInitScript((v) => localStorage.setItem('pinhead_feature_orderStudio', v), stored);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: ERP_HOME })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Разделы заказа' })).toHaveCount(0);
  });
}
