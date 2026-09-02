import { test, expect } from '@playwright/test';
import { installSupabaseMock, buildStages } from './support/mockSupabase';

/**
 * МАРШРУТ ОБРАЗЦА ГЛАЗАМИ ОБЫЧНЫХ ЦЕХОВ И СКЛАДА (правки заказчика 02.09).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ДОПИСКА В `erp-experimental.spec.ts`. Тот спек
 * гоняется и в проекте `mobile`, а здесь проверяются ДЕСКТОПНЫЕ поверхности:
 * строка очереди цеха (`QueueRow`) и таблица заказов. Ниже 1024px это другая
 * разметка — карточки, — то есть другой интерфейс, а не тот же в меньшем
 * масштабе. Файл исключён из проекта `mobile` в `playwright.config.ts`, как
 * и остальные спеки десктопных таблиц.
 *
 * Заказ СВОЙ: базовые четыре держат visual-эталоны и счётчики очередей
 * в `erp-queue`/`erp-plan`, и подмешивать в них образец значило бы править
 * чужие проверки.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');
const FX_CREATED = '2026-07-15T08:00:00Z';

/**
 * Образец с ОДНИМ нанесением в маршруте — ровно то, что заводит
 * `erp_experimental_task_send` при входе карточки в шаг «Нанесения»
 * (`origin = 'experimental'`). Кроя и пошива в маршруте нет: их ведёт ЭКС.
 */
const SAMPLE_ORDER = {
  id: 'ord-s', bitrix_id: '55300', title: 'Образец: ветровка',
  manager: 'Ирина', launch_date: '2026-07-14', due_date: '2026-08-14',
  buffer_days: 1, priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'zip', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: FX_CREATED, updated_at: FX_CREATED,
  items: [{
    id: 'ord-s-i1', order_id: 'ord-s', product_type: 'Ветровка', variant: 'образец',
    qty: 2, production_type: 'samples', branding_methods: ['dtf'], branding_on: 'cut',
    notes: null, size_grid: null, sort_order: 10,
    created_at: FX_CREATED, updated_at: FX_CREATED,
    stages: buildStages('ord-s-i1', [
      { code: 'dtf', status: 'in_progress', qty_done: 1, origin: 'experimental' },
    ]),
    prints: [],
  }],
  materials: [],
  attachments: [],
};

/**
 * МАРШРУТ ОБРАЗЦА: ОБЫЧНЫЕ ЦЕХА — ТОЛЬКО ПОД НАНЕСЕНИЯ (правки 02.09, пп. 1 и 3).
 *
 * ЧТО ЭТОТ СТОРОЖ ПРОВЕРЯЕТ, А ЧТО НЕТ — сказано вслух, потому что половина
 * требования ему недоступна по построению.
 *
 * ПРОВЕРЯЕТ: положительную половину — нанесение образца доезжает до очереди
 * ОБЩЕГО цеха и помечено там как образец (шаг 6 эталонного маршрута:
 * «в обычном производственном цехе автоматически появляется ТОЛЬКО то
 * нанесение, которое менеджер указал при заведении заказа»). Это настоящий
 * сквозной путь: этап читается тем же `buildQueueEntries`, что и вся очередь.
 *
 * НЕ ПРОВЕРЯЕТ: что маршрут образца не ЗАВОДИТ крой и пошив. Проверка «в
 * „Закрое“ этого заказа нет» на фикстуре, где такого этапа нет, была бы зелёной
 * и на сломанном коде — то есть не сторожем. Отсутствие этапов держит
 * `utils/routes.test.ts` («Образец: только закупка») и `routeWalk.test.ts`,
 * оба проверены мутацией. Здесь оно лишь СЛЕДСТВИЕ, и записано ниже как
 * следствие: очереди кроя и швейки образца не показывают.
 *
 * И НЕ ПРОВЕРЯЕТ складскую цепочку: серверных триггеров в моке нет
 * по построению, задачи склада заводит база. Их сторожит
 * `utils/warehouseGate.test.ts`, читающий текст миграции, плюс проверка
 * на живой базе транзакцией с откатом.
 */
test.describe('Маршрут образца: цеха видят только нанесение', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, { orders: [SAMPLE_ORDER] });
    await page.clock.setFixedTime(FIXED_TIME);
  });

  test('нанесение образца стоит в очереди ОБЩЕГО цеха и помечено', async ({ page }) => {
    await page.goto('/queue/dtf?studio=0');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // `.first()`, а не `toHaveCount(1)`: класс CSS-модуля попадает и на вложенные
    // узлы строки, и точный счёт сторожил бы разметку, а не правило
    const row = page.locator('[class*="queueRow"]').filter({ hasText: '55300' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('ЭКС / ОБРАЗЕЦ');
  });

  test('в «Закрое» и «Швейке» образца нет — их ведёт ЭКС', async ({ page }) => {
    for (const dept of ['cutting', 'sewing']) {
      await page.goto(`/queue/${dept}?studio=0`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('[class*="queueRow"]').filter({ hasText: '55300' }))
        .toHaveCount(0);
    }
  });
});

/**
 * ГЕЙТ ОТГРУЗКИ: НЕЗАВЕРШЁННАЯ РАЗРАБОТКА ДЕРЖИТ ЗАКАЗ (правки 02.09, п. 2).
 *
 * После п. 1 у образца в маршруте остаётся одна закупка, а при отметке
 * «Закупка не требуется» — не остаётся ничего. Без этого гейта заказ объявлялся
 * бы «Готов к отгрузке» в НАЧАЛЕ разработки — на дашборде, в списке заказов
 * и в карточке, — и переставал бы считаться просроченным.
 *
 * Проверяются ОБЕ стороны: открытая разработка держит, закрытая отпускает.
 * Одной половины мало — сторож, знающий только «держит», прошёл бы и на коде,
 * который не отпускает НИКОГДА.
 */
test.describe('Отгрузка образца ждёт завершения разработки', () => {
  /** Образец, у которого вся работа маршрута закрыта */
  const shipOrder = (outcome: string | null) => ({
    ...SAMPLE_ORDER,
    id: 'ord-ship',
    bitrix_id: '55310',
    title: 'Образец: готов по этапам',
    items: [{
      ...SAMPLE_ORDER.items[0],
      id: 'ord-ship-i1',
      order_id: 'ord-ship',
      stages: buildStages('ord-ship-i1', [
        { code: 'dtf', status: 'done', qty_done: 2, origin: 'experimental' },
      ]),
    }],
    developments: [{
      id: 'dev-ship', item_id: 'ord-ship-i1', outcome, handed_to_warehouse_at: null,
    }],
  });

  const row = (page: import('@playwright/test').Page) =>
    page.getByRole('row').filter({ hasText: '55310' });

  test('незавершённая разработка не даёт статуса «Готов к отгрузке»', async ({ page }) => {
    await installSupabaseMock(page, { orders: [shipOrder(null)] });
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto('/orders?studio=0');
    await expect(row(page)).toBeVisible();
    await expect(row(page)).not.toContainText('Готов к отгрузке');
  });

  test('после «Завершить разработку» заказ становится готовым', async ({ page }) => {
    await installSupabaseMock(page, { orders: [shipOrder('ready_for_serial')] });
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto('/orders?studio=0');
    await expect(row(page)).toContainText('Готов к отгрузке');
  });
});
