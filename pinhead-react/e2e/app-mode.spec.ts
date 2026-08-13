import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Переключение разделов 🏭 Производство ↔ ✏️ ТЗ.
 *
 * Блокер QA 13.08.2026: из Order Studio нельзя было вернуться в ERP.
 * Кнопка «🏭 Производство» перехватывалась `beforeunload`-стражем визарда
 * («заказ не сохранён»), браузер показывал нативный диалог, автоматика его
 * отменяла — и не происходило ничего: ни запроса, ни сообщения, ни записи
 * в консоли. Флаг режима при этом общий на профиль, поэтому залипали ВСЕ
 * вкладки сразу, а перезагрузка не помогала.
 *
 * Юнит `src/config/appMode.test.ts` сторожит правила выбора режима. Здесь —
 * то, чего юнит увидеть не может: настоящий `beforeunload` в настоящем
 * браузере. Именно на нём блокер и держался.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00Z');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await installSupabaseMock(page);
});

test('возврат из Order Studio работает при незаконченном визарде', async ({ page }) => {
  // Диалог `beforeunload` здесь — сам дефект: если он всплывёт, переход
  // отменится и тест упадёт на проверке раздела.
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });

  await page.goto('/?studio=0');
  // Черновик менеджера, который начал заказ и не закончил: ровно то состояние,
  // при котором страж визарда просыпается.
  await page.evaluate(() => {
    localStorage.setItem('pinhead_draft', JSON.stringify({ step: 2, saved: false }));
  });

  await page.getByRole('button', { name: 'Order Studio' }).click();
  await expect(page.getByRole('button', { name: '🏭 Производство' })).toBeVisible();

  await page.getByRole('button', { name: '🏭 Производство' }).click();

  await expect(page.getByRole('navigation').getByRole('link', { name: 'Обзор' })).toBeVisible();
  expect(dialogs, 'намеренное переключение раздела — не уход с сайта').toEqual([]);
  // Режим виден в адресе: ссылку можно передать, чужая вкладка не мешает
  await expect(page).toHaveURL(/studio=0/);
});

test('маршрут ERP открывает ERP даже при залипшем флаге Studio', async ({ page }) => {
  // Аварийный выход: любая ссылка на производство возвращает человека
  // из Studio без DevTools и без очистки данных сайта.
  await page.goto('/?studio=1');
  await expect(page.getByRole('button', { name: '🏭 Производство' })).toBeVisible();

  await page.goto('/board');
  await expect(page.getByRole('heading', { name: 'Доска производства' })).toBeVisible();

  // И память чинится: следующий переход по общему адресу не возвращает Studio
  await page.getByRole('navigation').getByRole('link', { name: 'Заказы' }).click();
  await expect(page.getByRole('heading', { name: /Заказы/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Order Studio' })).toBeVisible();
});
