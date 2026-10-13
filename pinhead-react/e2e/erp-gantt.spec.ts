import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * ГАНТ — четвёртая вкладка «Производства» (правки 07.09, п. 19).
 *
 * ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ И ЧТО НЕТ. Правило «откуда взята дата» покрыто
 * `src/erp/utils/gantt.test.ts` на всех сочетаниях — тут его повторять нечего.
 * Спека сторожит СВЯЗКУ, которой unit не видит: вкладка ведёт на экран,
 * период живёт в адресе (диаграмму пересылают ссылкой), и полоса-догадка
 * помечена в разметке, а не только в модели.
 *
 * ПОЧЕМУ ФИКСИРОВАННОЕ ВРЕМЯ. Фикстуры моков стоят в июле 2026: без него
 * период по умолчанию — сегодняшняя неделя, и диаграмма пуста по построению.
 */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-20T09:00:00Z'));
  await installSupabaseMock(page);
});

test('вкладка «Гант» открывает диаграмму', async ({ page }) => {
  await page.goto('/board?studio=0');
  await page.getByRole('link', { name: 'Гант' }).click();
  await expect(page).toHaveURL(/\/gantt/);
  await expect(page.getByRole('heading', { name: 'Гант', level: 1 })).toBeVisible();
});

test('период живёт в адресе и переключается кнопками', async ({ page }) => {
  await page.goto('/gantt?studio=0&from=2026-07-06&days=30');
  const region = page.getByRole('region', { name: 'Диаграмма Ганта' });
  await expect(region).toBeVisible();

  await page.getByRole('button', { name: 'Вперёд' }).click();
  // 6 июля + 30 дней = 5 августа: следующий период начинается там, где кончился
  await expect(page).toHaveURL(/from=2026-08-05/);

  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page).toHaveURL(/from=2026-07-06/);
});

test('полоса по сроку заказа помечена как догадка', async ({ page }) => {
  /**
   * ГЛАВНОЕ УТВЕРЖДЕНИЕ ЭКРАНА. Плановых дат у этапов почти нет, и полоса
   * строится по сроку ЗАКАЗА. Выданная за план, она опаснее пустой диаграммы:
   * по ней начнут принимать решения о сроках. Проверяем оба конца — подпись
   * источника словами и признак в самой полосе (класс штриховки).
   */
  await page.goto('/gantt?studio=0&from=2026-07-06&days=30');
  await expect(page.getByText(/Штриховкой показаны полосы/)).toBeVisible();
  await expect(page.getByText('срок заказа → срок заказа').first()).toBeVisible();
  await expect(page.locator('[class*="ganttBarGuess"]').first()).toBeVisible();
});

test('за пределами периода диаграмма честно пуста', async ({ page }) => {
  // Не «сломалась», а «в этом периоде этапов нет» — с объяснением, откуда даты
  await page.goto('/gantt?studio=0&from=2027-01-04&days=14');
  await expect(page.getByText('В этом периоде этапов нет')).toBeVisible();
});
