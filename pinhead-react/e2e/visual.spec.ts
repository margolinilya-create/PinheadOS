import { test, expect, type Locator, type Page } from '@playwright/test';
import { installSupabaseMock, FX_CREATED } from './support/mockSupabase';
import { orderCatalogs, staffFx } from './support/orderCatalogFx';

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

async function shoot(page: Page, name: string, target?: Locator) {
  /**
   * КУРСОР УВОДИТСЯ ИЗ УГЛА ПЕРЕД СНИМКОМ (правка 22.09).
   *
   * Playwright держит мышь в (0,0), а там логотип раздела — и он попадает
   * в кадр под `:hover`. Локально и на CI это состояние совпадает не всегда,
   * и разница выходит ОДИНАКОВАЯ на каждом экране: ровно 52 пикселя, один
   * и тот же прямоугольник значка. Именно на них разъехались тринадцать
   * эталонов ERP после пересъёмки 22.09.
   *
   * Измерено, а не предположено: при потолке в 1 пиксель снимок с мышью
   * в (0,0) совпадает с эталоном в ноль, с отведённой — расходится на 52.
   *
   * Сначала это объяснили «дрожью растеризатора» и подняли потолок до 120.
   * Объяснение было неверным (ту же находку прошлая сессия уже записывала
   * как логотип под `:hover`), а поднятый потолок ослаблял сторожа втрое.
   * Теперь причина убрана в корне, и потолок вернулся к 40.
   */
  await page.mouse.move(2000, 2000);
  /*
   * `target` — снимок ЭЛЕМЕНТА, а не страницы. Нужен оболочке Order: там
   * прокручивается `.orderMain`, а не окно, и `fullPage` снял бы ровно
   * высоту окна — то же, что без него, только с ложным обещанием «всё».
   */
  const subject = target ?? page;
  await expect(subject).toHaveScreenshot(`${name}.png`, {
    ...(target ? {} : { fullPage: true }),
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
     *
     * 22.09 потолок ненадолго подняли до 120 из-за расхождения в 52 пикселя
     * на тринадцати экранах. Причину тогда назвали неверно («дрожь
     * растеризатора»), а она оказалась воспроизводимой и устранимой —
     * логотип под курсором, см. `page.mouse.move` выше. Причина убрана,
     * потолок вернулся. Поднимать его — последнее средство, и только когда
     * расхождение не воспроизводится и не объясняется.
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

/**
 * Рабочее место заказа v4 (`/sales/:id`, веха 3): вкладка «Изделие» —
 * список позиций и панели визарда. Снимается прокручиваемый контейнер
 * оболочки (`main#main-content`, класс `.orderMain`), а не страница:
 * окно в оболочке Order не прокручивается. Эталоны (desktop/mobile)
 * снимает владелец — `update_snapshots` визуальной джобы CI.
 */
test('visual: studio-workplace', async ({ page }) => {
  const id = '6f1c2d3e-0000-4000-8000-0000000000ee';
  // Мок из beforeEach перекрывается: Playwright отдаёт запрос последнему перехватчику
  await installSupabaseMock(page, {
    salesOrders: [{
      id,
      schema_version: 4,
      order_number: 'PH-9100',
      title: 'Худи для команды',
      customer: 'ООО Тест',
      status: 'draft',
      kind: 'run',
      price_total: null,
      due_date: null,
      updated_at: FX_CREATED,
      created_by: null,
      order_items: [{
        id: '6f1c2d3e-0000-4000-8000-0000000000e1',
        kind: 'sku',
        sku_code: 'H-002',
        product_type: 'Худи',
        size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Чёрный (40-01)', sizes: { M: 10, L: 5 } }] },
        extras: [],
        sort_order: 0,
        order_item_prints: [],
        order_item_labels: [],
      }],
      order_notes_cards: [],
    }],
  });
  await page.goto(`/sales/${id}?tab=item&studio=1`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PH-9100 · ООО Тест');
  await expect(page.getByRole('spinbutton', { name: 'Размер M', exact: true })).toHaveValue('10');
  await shoot(page, 'studio-workplace', page.locator('#main-content'));
});

/**
 * «Справочники заказа» (`/order-settings`, веха 4): вкладка «Поставщики
 * и палитры» на фикстуре из двух поставщиков — список, карточка поставщика
 * по умолчанию и таблица палитры с образцами. Снимается контейнер оболочки,
 * как у рабочего места, в окне высотой 2000 px. Эталоны (desktop/mobile) снимает владелец —
 * `update_snapshots` визуальной джобы CI.
 */
test('visual: studio-settings', async ({ page }) => {
  await installSupabaseMock(page, { catalogs: orderCatalogs() });
  await page.goto('/order-settings?tab=suppliers&studio=1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Справочники заказа');
  await expect(page.getByRole('region', { name: 'Цвета палитры Коттонпром' })).toBeVisible();
  // Таблица палитры — ниже первого экрана, а она здесь главное (образцы,
  // снятые цвета). Снимок элемента внутри прокручиваемого `.orderMain`
  // за краем окна выходит пустым, поэтому окно выше: контейнер вмещает экран
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 2000 });
  await expect(page.getByRole('region', { name: 'Цвета палитры Коттонпром' })).toBeInViewport();
  await shoot(page, 'studio-settings', page.locator('#main-content'));
});

/** «Сотрудники продаж» (`/sales-staff`): две колонки признаков — «Ведёт заказы» и «МС» */
test('visual: studio-staff', async ({ page }) => {
  await installSupabaseMock(page, { salesStaff: staffFx() });
  await page.goto('/sales-staff?studio=1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сотрудники продаж');
  await expect(page.getByRole('checkbox', { name: 'МС: Олег Петров' })).toBeVisible();
  await shoot(page, 'studio-staff', page.locator('#main-content'));
});
