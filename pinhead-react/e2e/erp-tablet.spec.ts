import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Планшет цеха (проект `tablet`, 768×1024, hasTouch).
 *
 * Это основное рабочее устройство ERP, и до 29.07.2026 оно не было покрыто
 * ничем: гонялись только 1280 и 375. Ровно в этой дыре жил баг — брейкпоинт
 * стоял на `max-width: 760px`, а планшет в портрете это 768–800 CSS-px, то есть
 * **760 < 768**. Следствия: тач-оптимизированная `QueueCard` не показывалась
 * ни на одном реальном цеховом устройстве, а сайдбар оставался постоянной
 * колонкой 236px и оставлял под сетку строки очереди ~456px при нужных ~710px —
 * рабочая область уезжала вбок вместе с колонкой действий.
 *
 * Спек проверяет не «пиксель в пикселе», а три свойства, которые и ломались:
 * тот ли компонент отрисован, влезает ли он в экран, доступны ли действия.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

test.describe('Очередь цеха на планшете', () => {
  test('задания рисуются карточками, а не десктопной строкой', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    // Именно это и было сломано: на 768px рендерился QueueRow
    await expect(page.locator('[class*="queueRowMain"]')).toHaveCount(0);
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('карточка целиком влезает в ширину экрана', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    const card = page.locator('[class*="queueCard"]').first();
    await expect(card).toBeVisible();
    const viewport = page.viewportSize();
    // toPass: список догружается и перемонтирует карточки — одиночный
    // boundingBox() ловит уже отсоединённый узел
    await expect(async () => {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    }).toPass({ timeout: 10_000 });
  });

  test('действия цеха видны без горизонтальной прокрутки', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    const viewport = page.viewportSize()!;
    // Раньше колонка действий уезжала за правый край: под сетку оставалось
    // ~456px при нужных ~710px. Проверяем каждую видимую кнопку действия.
    const actions = page.getByRole('button', { name: /Взять в работу|Записать результат|Завершить этап|Проблема/ });
    // Ждём появления кнопок, а не считаем сразу: карточка видна раньше, чем
    // панель действий получает права и данные этапа
    await expect(actions.first()).toBeVisible();
    const count = await actions.count();
    for (let i = 0; i < count; i += 1) {
      const box = await actions.nth(i).boundingBox();
      if (!box) continue;
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});

test.describe('Оболочка на планшете', () => {
  test('сайдбар — оверлей: не съедает ширину, открывается бургером', async ({ page }) => {
    await page.goto('/?studio=0');
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    // До 1024px сайдбар обязан быть оверлеем, иначе постоянная колонка 236px
    // забирает треть экрана планшета
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    const sewing = page.getByRole('complementary').getByRole('link', { name: /Швейка/ });
    await expect(sewing).not.toBeInViewport();

    await menu.click();
    await expect(sewing).toBeInViewport();
  });

  test('тач-таргеты действий не мельче 44px', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    const actions = page.getByRole('button', { name: /Взять в работу|Завершить этап|Проблема/ });
    await expect(actions.first()).toBeVisible();
    const count = await actions.count();
    for (let i = 0; i < count; i += 1) {
      const box = await actions.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});
