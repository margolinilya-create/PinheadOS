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
    // Клик со смещением вправо: затемнение — inset:0 (375px), а выехавший сайдбар
    // занимает левые 236px и лежит НАД ним. Клик в центр (x≈187) попадал в сайдбар
    // и проходил только пока панель ещё ехала (180 мс анимации) — на загруженном
    // раннере тест падал по таймауту. Полоса x = 236…375 свободна всегда.
    await page.getByRole('button', { name: 'Закрыть меню' }).click({ position: { x: 320, y: 400 } });
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
    // Правка заказчика 16.08: карточка — отдельная страница, а не панель.
    // На телефоне это тем более верно: панель и так занимала экран целиком,
    // но при этом ограничивала себя шириной, рассчитанной на десктоп.
    await expect(page).toHaveURL(/\/orders\/ord-/);
    await expect(page.getByRole('tab', { name: /Позиции/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
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

/**
 * Производственный план на телефоне.
 *
 * Экран исключён из mobile-проекта в конфиге, и правильно: недельная доска
 * из пяти колонок на 375px — не desktop-разметка в меньшем масштабе. Но и без
 * покрытия он оставаться не должен: ниже 760px колонка дня занимает 88vw
 * и доска листается вбок — это осознанный мобильный вид, а не побочный эффект.
 * Поэтому проверяем его здесь, своим сценарием.
 */
test.describe('План производства на телефоне', () => {
  // Слоты фикстур стоят на неделе 20 июля — время у этого блока своё
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-20T09:00:00'));
  });

  test('колонка дня занимает почти всю ширину, доска листается вбок', async ({ page }) => {
    await page.goto('/plan?dept=cutting&studio=0');
    await expect(page.getByRole('heading', { name: 'План производства' })).toBeVisible();

    const day = page.getByText('Понедельник').locator('..').locator('..');
    const box = await day.boundingBox();
    expect(box).not.toBeNull();
    // 88vw от 375px — колонка шире половины экрана, но в него влезает
    expect(box!.width).toBeGreaterThan(280);
    expect(box!.width).toBeLessThanOrEqual(375);
  });

  test('страница не уезжает вбок — прокрутка только внутри доски', async ({ page }) => {
    await page.goto('/plan?dept=cutting&studio=0');
    await expect(page.getByRole('heading', { name: 'План производства' })).toBeVisible();

    // Горизонтально прокручивается доска, а не документ: иначе уезжает вся страница
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  test('сводка «Все цеха» читается без горизонтальной прокрутки страницы', async ({ page }) => {
    await page.goto('/plan?studio=0');
    await expect(page.getByRole('tab', { name: 'Все цеха' })).toHaveAttribute('aria-selected', 'true');
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  test('в план можно попасть из выезжающего меню', async ({ page }) => {
    // Путь изменился: отдельного пункта «План производства» в меню больше нет,
    // три соседних пункта сведены в раздел «Производство» с вкладками
    // (Доска · План · Загрузка). Проверяем НОВЫЙ путь целиком, потому что на
    // телефоне он длиннее десктопного: меню → раздел → вкладка.
    await page.goto('/?studio=0');
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByRole('complementary').getByRole('link', { name: 'Производство' }).click();
    await expect(page).toHaveURL(/\/board/);
    // Меню обязано закрыться, иначе страница остаётся под оверлеем
    await expect(page.getByRole('button', { name: 'Меню', exact: true }))
      .toHaveAttribute('aria-expanded', 'false');

    // Вкладки раздела доступны на телефоне — иначе план с него недостижим
    await page.getByRole('link', { name: 'План', exact: true }).click();
    await expect(page).toHaveURL(/\/plan/);
    await expect(page.getByRole('link', { name: 'План', exact: true }))
      .toHaveAttribute('aria-current', 'page');
  });
});
