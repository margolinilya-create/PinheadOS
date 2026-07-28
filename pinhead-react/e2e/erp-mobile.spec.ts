import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Мобильные сценарии ERP (проект `mobile`, 375×812).
 *
 * Раньше `erp-queue.spec.ts` гонялся только проектом `desktop`, а мобильный
 * интерфейс не покрывался ничем, кроме скриншотов: ниже 760px это ДРУГАЯ
 * разметка, а не та же в меньшем масштабе — сайдбар становится выезжающим
 * оверлеем, очередь рисуется карточками (`QueueCard`) вместо строк (`QueueRow`),
 * производственный план — карточками (`BoardCardMobile`) вместо таблицы.
 * Гонять здесь desktop-спеки бессмысленно: они проверяют разметку, которой нет.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

test.describe('Мобильная навигация ERP', () => {
  test('сайдбар скрыт и открывается кнопкой «Меню»', async ({ page }) => {
    await page.goto('/?studio=0');
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    // Пункт цеха до открытия меню недоступен: сайдбар уехал за край экрана
    const sewing = page.getByRole('complementary').getByRole('link', { name: /Швейка/ });
    await expect(sewing).not.toBeInViewport();

    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(sewing).toBeInViewport();
  });

  test('затемнение закрывает меню', async ({ page }) => {
    await page.goto('/?studio=0');
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByRole('button', { name: 'Закрыть меню' }).click();
    await expect(page.getByRole('button', { name: 'Меню', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toHaveCount(0);
  });

  test('переход в цех закрывает меню — иначе очередь остаётся под оверлеем', async ({ page }) => {
    await page.goto('/?studio=0');
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByRole('complementary').getByRole('link', { name: /Закрой/ }).click();
    await expect(page).toHaveURL(/\/queue\/cutting/);
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toHaveCount(0);
  });
});

test.describe('Очередь цеха на телефоне', () => {
  test('задания рисуются карточками, а не строками', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    const card = page.locator('[class*="queueCard"]').first();
    await expect(card).toBeVisible();
    // Компактная строка — десктопный вид, на 375px её быть не должно
    await expect(page.locator('[class*="queueRowMain"]')).toHaveCount(0);
  });

  test('карточка целиком влезает в ширину экрана', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    const card = page.locator('[class*="queueCard"]').first();
    await expect(card).toBeVisible();
    const viewport = page.viewportSize();
    // Замер через toPass: список догружается и перемонтирует карточки, поэтому
    // одиночный boundingBox() ловил уже отсоединённый узел и возвращал null
    await expect(async () => {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    }).toPass({ timeout: 10_000 });
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Производственный план на телефоне', () => {
  test('позиции рисуются карточками вместо уехавшей за край таблицы', async ({ page }) => {
    await page.goto('/board?studio=0');
    const card = page.locator('[class*="orderCardM"]').first();
    await expect(card).toBeVisible();
    // На 375px таблица показывала только «№ / Заказ / Кол-во»
    await expect(page.locator('table')).toHaveCount(0);
    // Срок и прогресс — то, ради чего экран и открывают — видны
    await expect(card.getByText(/%/).first()).toBeVisible();
  });
});

test.describe('Список заказов на телефоне', () => {
  test('заказы рисуются карточками и ведут в карточку заказа', async ({ page }) => {
    await page.goto('/orders?studio=0');
    const card = page.locator('[class*="orderCardM"]').first();
    await expect(card).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);

    await card.getByRole('link').first().click();
    // Боковая карточка на телефоне занимает экран целиком; проверяем, что открылась
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/[?&]order=ord-/);
  });
});

test.describe('Модалка на телефоне', () => {
  test('кнопки формы создания заказа видны без прокрутки', async ({ page }) => {
    await page.goto('/orders?new=1&studio=0');
    const dialog = page.getByRole('dialog', { name: /Новый производственный заказ/ });
    await expect(dialog).toBeVisible();

    // Кнопки залипающие: длинная форма иначе уводила «Создать» за пределы экрана
    const submit = dialog.getByRole('button', { name: /Создать заказ/ });
    await expect(submit).toBeInViewport();

    // и остаются на месте после прокрутки формы вниз
    await dialog.getByRole('button', { name: /Позиции/ }).first().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 1200);
    await expect(submit).toBeInViewport();
  });
});
