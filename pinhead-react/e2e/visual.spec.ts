import { test, expect, type Locator, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { installSupabaseMock, FX_CREATED, type MockExtras } from './support/mockSupabase';
import { seedFlatsCatalog } from './support/flatsFixture';
import { FLATS_ITEM, FLATS_ORDER, darkTheme, dbCatalogs, designExtras } from './support/visualStudioFx';
import { orderCatalogs, staffFx } from './support/orderCatalogFx';
import { TEE, adminExtras, teeObjects, teeV2WithHistory } from './support/flatsAdminFx';
import { flowMock } from './support/orderFlowFx';
import { buildOrder, launchButton, markPrepaid, openLaunchAsMs, sentOrder } from './support/orderFlowUi';
import { TZ_VISUAL_NOW, renderTz67108 } from './support/tzPdfVisualFx';

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

async function shoot(page: Page, name: string, target?: Locator, mask: Locator[] = [], ratio?: number) {
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
    // Маска — для области, чей пиксельный вид зависит от растеризатора, а не от кода
    // (холст konva): её содержимое сторожат unit-тесты сцены и e2e order-design.spec.ts
    ...(mask.length ? { mask } : {}),
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
    // Экраны 6+7 — допуск долей (1 %, план задачи 7): длинные формы с живыми датами и ценой
    ...(ratio ? { maxDiffPixelRatio: ratio } : { maxDiffPixels: 40 }),
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

/**
 * Бизнес-задачи (правки 19.10, п. 7): общий раздел и карточка фикстурной задачи
 * `bt-1` (мок `support/mock/bizTasksRpc.ts`). Эталоны снимает владелец: имя
 * начинается с `erp-`, а CI по умолчанию переснимает только `studio-` (К13 вехи 8).
 */
test('visual: erp-biz-tasks', async ({ page }) => {
  skipUntilBaseline('erp-biz-tasks');
  await page.goto('/biz-tasks?studio=0');
  await expect(page.getByRole('heading', { level: 1, name: 'Бизнес-задачи' })).toBeVisible();
  // Фильтры и вкладки; список «Мне» у dev-автологина пуст (`currentUserId()` гасит id `dev`)
  await expect(page.getByRole('tablist', { name: 'Мои задачи' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Статус' })).toBeVisible();
  await shoot(page, 'erp-biz-tasks');
});

test('visual: erp-biz-tasks-card', async ({ page }) => {
  skipUntilBaseline('erp-biz-tasks-card');
  await page.goto('/biz-tasks/bt-1?studio=0');
  await expect(page.getByRole('heading', { level: 1, name: 'Заказать молнии' })).toBeVisible();
  // На ≤ 760 px диалог — за вкладкой «Обсуждение»: снимается вкладка «Задача»
  if ((page.viewportSize()?.width ?? 1280) > 760) {
    await expect(page.getByText('Уточни срок у поставщика')).toBeVisible();
  } else {
    await expect(page.getByRole('tablist', { name: 'Разделы задачи' })).toBeVisible();
  }
  await shoot(page, 'erp-biz-tasks-card');
});

// ─── Order Studio (каталог) — флаг включён (?studio=1) ───
// Визард (/) сюда не включён: его fullPage-скриншот нестабилен из-за
// ленивой подгрузки картинок SKU на длинной странице.

const desktopOnly = (name: string) => (name !== 'desktop');

async function shootSku(page: Page, name: string) {
  await installSupabaseMock(page, { catalogs: dbCatalogs() });
  await page.goto('/sku?studio=1');
  await expect(page.getByRole('heading', { level: 1, name: 'Каталог моделей и цен' })).toBeVisible();
  await expect(page.getByText(/^Каталог не загрузился из базы/)).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1280) <= 760) {
    // На телефоне — только просмотр (К2)
    await expect(page.getByRole('note').filter({ hasText: 'На телефоне каталог только для просмотра. Править — с компьютера.' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Сохранить каталог' })).toBeVisible();
  }
  await shoot(page, name);
}

test('visual: studio-sku', async ({ page }) => {
  await shootSku(page, 'studio-sku');
});

test('visual: studio-sku-dark', async ({ page }, info) => {
  test.skip(desktopOnly(info.project.name), 'Тёмная тема — на десктопе; телефон снимается в светлой');
  skipUntilBaseline('studio-sku-dark');
  await darkTheme(page);
  await shootSku(page, 'studio-sku-dark');
});

/**
 * «Экспресс-расчёт» (`/express`, веха 8, задача 4): изделие, ткань, зона по умолчанию —
 * виден блок зоны с выбором техники и итог «Итого за {qty} шт»
 */
async function shootExpress(page: Page, name: string) {
  await installSupabaseMock(page, { catalogs: dbCatalogs() });
  await page.goto('/express?studio=1');
  await expect(page.getByRole('heading', { level: 1, name: 'Экспресс-расчёт' })).toBeVisible();
  await page.getByLabel('Изделие').selectOption({ label: 'Футболка Free Fit' });
  const fabric = page.getByLabel('Ткань');
  await fabric.selectOption({ index: 1 });
  // Лицевая сторона включена по умолчанию — её блок с выбором техники и цена зоны
  const zone = page.getByRole('group', { name: 'Зоны нанесения' }).getByRole('button', { name: /Лицевая сторона/ });
  await expect(zone).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radiogroup', { name: 'Техника' }).first()).toBeVisible();
  await expect(page.getByText(/^Итого за 100 шт/).first()).toBeVisible();
  await shoot(page, name, page.locator('#main-content'));
}

test('visual: studio-express', async ({ page }) => {
  skipUntilBaseline('studio-express');
  await shootExpress(page, 'studio-express');
});

test('visual: studio-express-dark', async ({ page }, info) => {
  test.skip(desktopOnly(info.project.name), 'Тёмная тема — на десктопе; телефон снимается в светлой');
  skipUntilBaseline('studio-express-dark');
  await darkTheme(page);
  await shootExpress(page, 'studio-express-dark');
});

/**
 * Рабочее место заказа v4 (`/sales/:id`, веха 3): вкладка «Изделие» —
 * список позиций и панели визарда. Снимается прокручиваемый контейнер
 * оболочки (`main#main-content`, класс `.orderMain`), а не страница:
 * окно в оболочке Order не прокручивается. Эталоны (desktop/mobile)
 * снимает владелец — `update_snapshots` визуальной джобы CI.
 */
async function shootWorkplace(page: Page, name: string) {
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
  await shoot(page, name, page.locator('#main-content'));
}

test('visual: studio-workplace', async ({ page }) => {
  await shootWorkplace(page, 'studio-workplace');
});

test('visual: studio-workplace-dark', async ({ page }, info) => {
  test.skip(desktopOnly(info.project.name), 'Тёмная тема — на десктопе; телефон снимается в светлой');
  skipUntilBaseline('studio-workplace-dark');
  await darkTheme(page);
  await shootWorkplace(page, 'studio-workplace-dark');
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

/**
 * НОВЫЙ ЭТАЛОН ЕЩЁ НЕ СНЯТ — тест пропускается, а не краснеет (веха 5а). Эталоны
 * снимает владелец (`update_snapshots` визуальной джобы CI): без этого обычный
 * прогон падал бы на «A snapshot doesn't exist», не найдя ни одного изменения вида.
 * С `--update-snapshots` (режимы `changed`/`all`) тест идёт и пишет эталон. Как
 * только PNG появился в `visual.spec.ts-snapshots/`, пропуска больше нет.
 */
function skipUntilBaseline(name: string) {
  const info = test.info();
  const updating = info.config.updateSnapshots === 'all' || info.config.updateSnapshots === 'changed';
  test.skip(!updating && !existsSync(info.snapshotPath(`${name}.png`, { kind: 'screenshot' })),
    `эталона ${name} ещё нет — снимет владелец (update_snapshots)`);
}

/**
 * Вкладка «Дизайн» (веха 5а): холст с одним логотипом, панель, шапка. Пиксели
 * самого холста под маской (растеризатор konva), рамка, панель и шапка — нет.
 * На телефоне — превью-картинка (`DesignPreview`), снимается целиком.
 */
test('visual: studio-design', async ({ page }) => {
  skipUntilBaseline('studio-design');
  await installSupabaseMock(page, designExtras());
  await page.goto(`/sales/${FLATS_ORDER}?tab=design&item=${FLATS_ITEM}&studio=1`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PH-9100 · ООО Тест');
  const compact = (page.viewportSize()?.width ?? 1280) <= 760;
  if (compact) {
    await expect(page.getByRole('img', { name: /нанесений 1$/ })).toBeVisible();
  } else {
    await expect(page.getByRole('application', { name: /^Холст/ })).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('list', { name: 'Нанесения на виде' }).getByRole('listitem')).toHaveCount(1);
  }
  await shoot(page, 'studio-design', page.locator('#main-content'), compact ? [] : [page.locator('canvas')]);
});

/** «Справочники заказа» → «Флэты и зоны»: таблица из трёх флэтов сида */
test('visual: studio-settings-flats', async ({ page }) => {
  skipUntilBaseline('studio-settings-flats');
  const catalogs = orderCatalogs() as MockExtras['catalogs'] & { app_config: Record<string, unknown> };
  catalogs.app_config.garmentFlats = seedFlatsCatalog(['tshirt-freefit', 'hoodie-classic', 'shopper-classic']);
  await installSupabaseMock(page, { catalogs });
  await page.goto('/order-settings?tab=flats&studio=1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Справочники заказа');
  // Счётчик — подпись таблицы на десктопе и подпись списка карточек на ≤ 760 (веха 5б)
  await expect(page.getByText('Флэтов в справочнике: 3').or(page.getByRole('list', { name: 'Флэтов в справочнике: 3' }))).toBeVisible();
  await shoot(page, 'studio-settings-flats', page.locator('#main-content'));
});

/**
 * Редактор флэта (веха 5б, задача 7): флэт сида на версии 2 с историей, вкладка
 * «Зоны» с выбранной зоной. Холст konva под маской — его сцену сторожит юнит
 * `sceneText` (T6а) и e2e `order-flats-admin.spec.ts`, а не пиксели; снимок ждёт
 * `data-ready`. Ширины — 1280 и 900 px (761–1100: одна колонка панели), темы —
 * светлая и тёмная (системная, `prefers-color-scheme`). На телефоне редактора
 * нет — эталон `FlatPreview`: картинка `<img>` и список зон, без холста.
 */
async function shootFlatEditor(page: Page, name: string, opts: { width?: number; dark?: boolean } = {}) {
  skipUntilBaseline(name);
  if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
  const compact = (page.viewportSize()?.width ?? 1280) <= 760;
  await page.setViewportSize({ width: opts.width ?? page.viewportSize()!.width, height: compact ? 1400 : 1600 });
  await installSupabaseMock(page, adminExtras([], teeV2WithHistory(), teeObjects(1, 2)));
  await page.goto(`/order-settings?tab=flats&flat=${TEE}&studio=1`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Справочники заказа');
  if (compact) {
    await expect(page.getByRole('img', { name: /^Силуэт «.+», вид Перед, зон: 1$/ })).toBeVisible();
    await shoot(page, name, page.locator('#main-content'));
    return;
  }
  await expect(page.getByRole('application', { name: /^Холст флэта/ })).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#flat-version-badge')).toHaveText('Версия 2');
  await shoot(page, name, page.locator('#main-content'), [page.locator('canvas')]);
}

test('visual: studio-settings-flat-editor', async ({ page }) => {
  await shootFlatEditor(page, 'studio-settings-flat-editor');
});

test('visual: studio-settings-flat-editor-dark', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Тёмная тема — на десктопе; телефон снимается в светлой');
  await shootFlatEditor(page, 'studio-settings-flat-editor-dark', { dark: true });
});

test('visual: studio-settings-flat-editor-900', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '900 px задаётся в тесте — один прогон');
  await shootFlatEditor(page, 'studio-settings-flat-editor-900', { width: 900 });
});

test('visual: studio-settings-flat-editor-900-dark', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '900 px задаётся в тесте — один прогон');
  await shootFlatEditor(page, 'studio-settings-flat-editor-900-dark', { width: 900, dark: true });
});

/** «Флэты и зоны» → «Зоны нанесения»: таблица справочника зон (на телефоне — карточки) */
test('visual: studio-settings-zones', async ({ page }) => {
  skipUntilBaseline('studio-settings-zones');
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 1600 });
  await installSupabaseMock(page, adminExtras([], teeV2WithHistory(), teeObjects(1, 2)));
  await page.goto('/order-settings?tab=flats&part=zones&studio=1');
  await expect(page.getByRole('heading', { name: 'Капюшон' }).or(page.getByLabel('Название зоны «Капюшон»'))).toBeVisible();
  await shoot(page, 'studio-settings-zones', page.locator('#main-content'));
});

// ─── Веха 6+7: «ТЗ и цена», «К запуску», PDF ТЗ образца 67108 ───

/** Сборка через экраны идёт на десктопной ширине (холст «Дизайн»), снимок — на ширине проекта */
const projectWidth = (page: Page) => page.viewportSize()!.width;
/** Тосты «Оплата отмечена», «Заказ отправлен…» живут секунды и ложатся поверх снимка элемента */
const toasts = (page: Page) => page.getByRole('status', { name: 'Оповещения' });

test('visual: studio-tz-summary', async ({ page }) => {
  skipUntilBaseline('studio-tz-summary');
  test.setTimeout(120_000);
  const width = projectWidth(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await buildOrder(page, flowMock([]));
  await markPrepaid(page);
  await page.setViewportSize({ width, height: 900 });
  await expect(page.getByRole('button', { name: 'Предпросмотр ТЗ' })).toBeVisible();
  await expect(page.getByText('Чек-лист пройден — заказ готов к отправке')).toBeVisible();
  await shoot(page, 'studio-tz-summary', page.locator('#main-content'), [toasts(page)], 0.01);
});

/** «К запуску» глазами МС; на телефоне (проект mobile) — 375 px */
test('visual: studio-launch', async ({ page }) => {
  skipUntilBaseline('studio-launch');
  test.setTimeout(120_000);
  const width = projectWidth(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const extra = flowMock([]);
  await sentOrder(page, extra);
  await openLaunchAsMs(page, extra);
  await expect(launchButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await page.setViewportSize({ width, height: 900 });
  // Просмотрщик PDF внутри iframe рисует браузер, а не код экрана
  await shoot(page, 'studio-launch', page.locator('#main-content'), [page.locator('iframe'), toasts(page)], 0.01);
});

/** PDF ТЗ 67108: страницы 1 (шапка) и 3 (бирки) — pdfjs в canvas, масштаб 2 */
test('visual: tz-pdf-67108', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PDF от ширины окна не зависит — один прогон');
  for (const n of [1, 3]) skipUntilBaseline(`tz-pdf-67108-p${n}`);
  await page.clock.setFixedTime(new Date(TZ_VISUAL_NOW));
  await page.goto('/sales?studio=1');
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(await renderTz67108(page, [1, 3])).toBe(10);
  for (const n of [1, 3]) {
    await expect(page.locator(`#tz-page-${n}`)).toHaveScreenshot(`tz-pdf-67108-p${n}.png`, { maxDiffPixelRatio: 0.01 });
  }
});
