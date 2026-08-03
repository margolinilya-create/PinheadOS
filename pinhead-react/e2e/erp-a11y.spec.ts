import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Прогон доступности по ключевым экранам ERP.
 *
 * Почему не axe. `axe-core` в дереве зависимостей нет, а правило проекта —
 * не добавлять пакеты без обсуждения. Проверки ниже покрывают ровно те
 * критерии, что перечислены в задаче аудита (skip-link, видимый фокус,
 * aria-live, роли вкладок и аккордеонов, доступные модалки, ориентиры,
 * подписи полей, alt у картинок) — их все можно проверить нативно.
 *
 * Отличие от axe в честную сторону: здесь проверяется НЕ «нет ли нарушений
 * вообще», а конкретные обещания интерфейса. Автоматический аудит ловит
 * шире, но и молчит там, где разметка формально верна, а пользоваться нельзя.
 */

const SCREENS = [
  { name: 'Обзор', url: '/?studio=0' },
  { name: 'Заказы', url: '/orders?studio=0' },
  { name: 'Доска производства', url: '/board?studio=0' },
  { name: 'Очередь цеха', url: '/queue/cutting?studio=0' },
  { name: 'Карточка заказа', url: '/orders/ord-a?studio=0' },
  { name: 'Загрузка цехов', url: '/load?studio=0' },
];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-20T09:00:00Z'));
  await installSupabaseMock(page);
});

/** Есть ли у элемента видимая рамка фокуса (не `outline: none` без замены) */
async function hasVisibleFocusRing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    // Замена контура тенью — тоже видимый фокус (так сделан примитив Button)
    const shadow = s.boxShadow !== 'none' && s.boxShadow !== '';
    return outline || shadow;
  });
}

test.describe('Ориентиры и заголовки', () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: один h1, есть main и nav`, async ({ page }) => {
      await page.goto(screen.url);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.getByRole('navigation').first()).toBeVisible();
      // Ровно один h1 — иначе навигация по заголовкам теряет точку входа
      const h1 = page.locator('h1');
      expect(await h1.count(), `${screen.name}: h1 должен быть ровно один`).toBe(1);
    });
  }
});

test.describe('Клавиатура', () => {
  test('skip-link — первая остановка Tab и уводит к содержимому', async ({ page }) => {
    // Сайдбар это 20+ ссылок, и без skip-link клавиатурный пользователь
    // проходил их заново на каждой странице.
    await page.goto('/orders?studio=0');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveText(/Перейти к содержимому/);
    await expect(focused).toHaveAttribute('href', '#main-content');
    await focused.press('Enter');
    await expect(page.locator('#main-content')).toBeVisible();
  });

  test('у первых интерактивных элементов виден фокус', async ({ page }) => {
    await page.goto('/orders?studio=0');
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      if (!['A', 'BUTTON', 'INPUT', 'SELECT'].includes(tag)) continue;
      expect(await hasVisibleFocusRing(page), `элемент ${tag} без видимого фокуса`).toBe(true);
    }
  });

  test('вкладки карточки заказа — полный таб-паттерн', async ({ page }) => {
    await page.goto('/orders/ord-a?studio=0');
    const tablist = page.getByRole('tablist', { name: /карточки заказа/i });
    await expect(tablist).toBeVisible();
    const active = page.getByRole('tab', { selected: true });
    // Панель связана с вкладкой в обе стороны
    const controls = await active.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    await expect(page.locator(`#${controls}`)).toHaveAttribute('role', 'tabpanel');
    // Roving tabindex: набор вкладок — одна остановка Tab, а не шесть
    const stops = await page.locator('[role="tab"][tabindex="0"]').count();
    expect(stops).toBe(1);
  });

  test('группы уведомлений сворачиваются с клавиатуры', async ({ page }) => {
    // Нативный <details> — потому и выбран: работает без единой строки JS
    await page.goto('/?studio=0');
    const summary = page.locator('details[class*="notifGroup"] summary').first();
    if (await summary.count() === 0) test.skip();
    await summary.focus();
    const wasOpen = await page.locator('details[class*="notifGroup"]').first()
      .evaluate((el: HTMLDetailsElement) => el.open);
    await page.keyboard.press('Enter');
    const nowOpen = await page.locator('details[class*="notifGroup"]').first()
      .evaluate((el: HTMLDetailsElement) => el.open);
    expect(nowOpen).toBe(!wasOpen);
  });
});

test.describe('Формы и объявления', () => {
  test('у каждого видимого поля есть доступное имя', async ({ page }) => {
    await page.goto('/orders?studio=0');
    const inputs = page.locator('input:visible, select:visible');
    const n = await inputs.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      const el = inputs.nth(i);
      const name = await el.evaluate((node) => {
        const byLabel = node.closest('label')?.textContent?.trim();
        return node.getAttribute('aria-label')
          || node.getAttribute('placeholder')
          || byLabel
          || '';
      });
      expect(name.length, `поле №${i + 1} без доступного имени`).toBeGreaterThan(0);
    }
  });

  test('тосты объявляются вспомогательным технологиям', async ({ page }) => {
    await page.goto('/orders?studio=0');
    const live = page.locator('[aria-live]');
    expect(await live.count()).toBeGreaterThan(0);
    await expect(live.first()).toHaveAttribute('aria-live', /polite|assertive/);
  });

  test('у картинок есть alt или роль представления', async ({ page }) => {
    await page.goto('/orders/ord-a?studio=0');
    const imgs = page.locator('img');
    const n = await imgs.count();
    for (let i = 0; i < n; i += 1) {
      const img = imgs.nth(i);
      const alt = await img.getAttribute('alt');
      const hidden = await img.getAttribute('aria-hidden');
      expect(alt !== null || hidden === 'true', `картинка №${i + 1} без alt`).toBe(true);
    }
  });
});

test.describe('Модалки', () => {
  test('форма создания заказа: роль диалога, Escape закрывает', async ({ page }) => {
    await page.goto('/orders?new=1&studio=0');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Фокус внутри диалога, а не остался снаружи
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return Boolean(d && document.activeElement && d.contains(document.activeElement));
    });
    expect(inside).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
