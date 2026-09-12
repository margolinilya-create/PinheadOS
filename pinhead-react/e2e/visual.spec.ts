import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Visual-регрешн ключевых экранов.
 *
 * Гоняется против dev-сервера (dev-автологин админом «Dev Mode»), Supabase
 * замокан фикстурами (см. support/mockSupabase.ts) — реальной БД и секретов
 * не требуется. Время заморожено, чтобы «X дн.» и даты не дрейфовали.
 *
 * Флаг раздела переключается per-navigation через URL: `?studio=0` → ERP
 * (Производство), `?studio=1` → Order Studio (визард/каталог). URL-параметр
 * приоритетнее env, поэтому спек не зависит от VITE_FEATURE_ORDER_STUDIO.
 */

// Понедельник 2026-07-20 09:00 — относительно него считаются сроки в фикстурах.
const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

async function shoot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    threshold: 0.15,
    /**
     * ДОПУСК НА РАССЫПАННОЕ СГЛАЖИВАНИЕ. Прогоны 04.09 дважды подряд валили
     * `erp-orders` на ШЕСТИ пикселях из миллиона: на диффе не видно ни одного
     * красного пятна — это дрожь растеризатора текста, а не изменение вида.
     * Перегенерация такого не лечит (эталон снят тем же кодом), а красный
     * прогон, который «иногда красный», — сторож, мимо которого смотрят.
     *
     * Потолок выбран НА ДВА ПОРЯДКА ниже настоящих находок этой же сессии:
     * появление чипа статуса в карточке очереди дало 5926 px, новая колонка
     * списка — 22039 и 27188. Изменение вида, которое уложится в 40 пикселей,
     * этим сторожем и не ловилось бы: у него `threshold: 0.15` на пиксель.
     */
    maxDiffPixels: 40,
  });
}

// ─── ERP (Производство) — флаг выключен (?studio=0) ───

test('visual: erp-dashboard', async ({ page }) => {
  await page.goto('/?studio=0');
  await expect(page.getByRole('heading', { name: 'Обзор производства' })).toBeVisible();
  await expect(page.getByText('Заказов в работе')).toBeVisible();
  await expect(page.getByText('Ближайшие дедлайны')).toBeVisible();
  await shoot(page, 'erp-dashboard');
});

test('visual: erp-orders', async ({ page }) => {
  await page.goto('/orders?studio=0');
  await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();
  await expect(page.getByText('BOX39 худи чёрные')).toBeVisible();
  await expect(page.getByText('Шопперы эко «Маркет»')).toBeVisible();
  await shoot(page, 'erp-orders');
});

test('visual: erp-board', async ({ page }) => {
  await page.goto('/board?studio=0');
  // Заголовок и вкладки раздела «Производство» (Доска · План · Загрузка) — итог
  // волны аудита Ф5; прежнее «Производственный план» осталось у экрана /plan.
  await expect(page.getByRole('heading', { name: 'Доска производства' })).toBeVisible();
  await expect(page.getByText('BOX39 худи чёрные').first()).toBeVisible();
  await shoot(page, 'erp-board');
});

test('visual: erp-queue', async ({ page }) => {
  // Экран цеха адресуется участком: `/queue` без кода больше не маршрут
  // (правки 07.09, п. 18), и подготовка localStorage для него не нужна
  await page.goto('/queue/cutting?studio=0');
  await expect(page.getByRole('heading', { name: 'Закройный цех' })).toBeVisible();
  await expect(page.getByText('В работе').first()).toBeVisible();
  // Группы очереди после разделения «ждёт материалы» и «ждёт предыдущий этап»
  // (правка менеджера 03.08): у закроя в фикстуре есть готовое к запуску задание,
  // а группы «Ожидает» нет — все предшественники сданы.
  await expect(page.getByText('Готово к запуску').first()).toBeVisible();
  await shoot(page, 'erp-queue');
});

/**
 * ЭКРАНОВ СТАЛО ТРИНАДЦАТЬ, А НЕ ЧЕТЫРЕ (12.09).
 *
 * До этой правки набор сторожил обзор, заказы, доску и очередь цеха — то есть
 * четыре поверхности из двадцати. План, Гант, загрузка, склад, закупка, подряд,
 * разработка, карточка заказа, страница задания и админка не сторожились
 * визуально ничем, а именно там живут самые плотные таблицы раздела.
 *
 * Цена прогона: каждый снимок — секунды, и это единственный сторож, который
 * вообще видит ВИД. Ни один из ~3900 unit-тестов дефекта вроде «полоса
 * прогресса не рисуется» или «число и месяц слиплись» не замечает
 * по построению: разметка та же, поведение то же.
 */

test('visual: erp-order-card', async ({ page }) => {
  await page.goto('/orders/ord-a?studio=0');
  await expect(page.getByRole('heading', { name: /BOX39 худи чёрные/ })).toBeVisible();
  await shoot(page, 'erp-order-card');
});

test('visual: erp-plan', async ({ page }) => {
  await page.goto('/plan?studio=0');
  await expect(page.getByRole('heading', { name: 'План производства' })).toBeVisible();
  await shoot(page, 'erp-plan');
});

test('visual: erp-gantt', async ({ page }) => {
  await page.goto('/gantt?studio=0');
  await expect(page.getByRole('heading', { name: 'Гант' })).toBeVisible();
  await shoot(page, 'erp-gantt');
});

test('visual: erp-load', async ({ page }) => {
  await page.goto('/load?studio=0');
  await expect(page.getByRole('heading', { name: /Загрузка цехов/ })).toBeVisible();
  await shoot(page, 'erp-load');
});

test('visual: erp-warehouse', async ({ page }) => {
  await page.goto('/warehouse?studio=0');
  await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible();
  await shoot(page, 'erp-warehouse');
});

test('visual: erp-purchasing', async ({ page }) => {
  await page.goto('/purchasing?studio=0');
  await expect(page.getByRole('heading', { name: 'Закупка' })).toBeVisible();
  await shoot(page, 'erp-purchasing');
});

test('visual: erp-subcontracting', async ({ page }) => {
  await page.goto('/subcontracting?studio=0');
  await expect(page.getByRole('heading', { name: 'Подряд' })).toBeVisible();
  await shoot(page, 'erp-subcontracting');
});

test('visual: erp-experimental', async ({ page }) => {
  await page.goto('/experimental?studio=0');
  await expect(page.getByRole('heading', { name: /Эксперим/ })).toBeVisible();
  await shoot(page, 'erp-experimental');
});

test('visual: erp-admin-roles', async ({ page }) => {
  await page.goto('/admin?tab=roles&studio=0');
  await expect(page.getByRole('heading', { name: 'Админка' })).toBeVisible();
  await shoot(page, 'erp-admin-roles');
});

// ─── Order Studio (каталог) — флаг включён (?studio=1) ───
// Каталоги замоканы пустыми → компоненты рендерятся на дефолтных данных.
// Визард (/) сюда не включён: его fullPage-скриншот нестабилен из-за
// ленивой подгрузки картинок SKU на длинной странице.

test('visual: studio-sku', async ({ page }) => {
  await page.goto('/sku?studio=1');
  await expect(page.getByText('Каталог SKU')).toBeVisible();
  await shoot(page, 'studio-sku');
});
