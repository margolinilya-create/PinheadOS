import { test, expect } from '@playwright/test';
import { installSupabaseMock, buildStages, FX_CREATED } from './support/mockSupabase';

/**
 * Закупка видит РАБОТУ, а не только материалы (правки заказчика 12.08).
 *
 * ЧТО ЭТО СТОРОЖИТ. Раздел «Закупка» был реестром строк `erp_materials`
 * и об этапах маршрута не знал вовсе. Заказ, у которого закупка стоит первым
 * этапом, а материалы ещё не заведены, не показывался НИГДЕ: в разделе
 * закупки — потому что показывать было нечего, в очереди и на канбане —
 * потому что участок непроизводственный и вырезан у всех потребителей.
 * На боевой базе так стояли 33 этапа.
 *
 * Unit-стороже (`routeReachable`, `supply`) проверяют правило; здесь проверяется
 * то, чего они по построению не видят: доходит ли заказ до ЭКРАНА и говорит ли
 * строка вслух, что материалов нет. Дефект был именно такой — правило можно
 * было прочитать в миграции, а экран его не исполнял.
 *
 * Заказы свои: базовые четыре держат visual-снапшоты и счётчики соседних спек.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

/** Главный случай дефекта: закупка открыта, материалов НЕТ вовсе */
const ORDER_NO_MATERIALS = {
  id: 'ord-e',
  bitrix_id: '55301',
  title: 'Платки тест закупка',
  customer: 'ООО «Ромашка»',
  manager: 'Анна',
  launch_date: '2026-07-18',
  due_date: '2026-07-28',
  buffer_days: 1,
  priority: 0,
  status: 'active',
  shipped_status: 'not_shipped',
  delivered_at: null,
  shipped_at: null,
  shipped_by: null,
  notes: null,
  packaging: 'none',
  packaging_note: null,
  stickers: 'none',
  stickers_note: null,
  no_chestny_znak: false,
  created_by: null,
  created_at: FX_CREATED,
  updated_at: FX_CREATED,
  items: [
    {
      id: 'ord-e-i1',
      order_id: 'ord-e',
      product_type: 'Платок',
      variant: 'шёлк',
      qty: 100,
      production_type: 'cut',
      branding_methods: [],
      branding_on: 'cut',
      notes: null,
      size_grid: null,
      sort_order: 10,
      created_at: FX_CREATED,
      updated_at: FX_CREATED,
      stages: buildStages('ord-e-i1', [
        { code: 'supply', status: 'ready' },
        { code: 'cutting', status: 'waiting', deps: [0] },
      ]),
      prints: [],
    },
  ],
  materials: [],
  attachments: [],
};

/** Закупка взята в работу, материалы заведены частично */
const ORDER_PARTIAL = {
  ...ORDER_NO_MATERIALS,
  id: 'ord-f',
  bitrix_id: '55302',
  title: 'Худи корпоратив «Вектор»',
  due_date: '2026-07-31',
  items: [
    {
      ...ORDER_NO_MATERIALS.items[0],
      id: 'ord-f-i1',
      order_id: 'ord-f',
      product_type: 'Худи',
      qty: 60,
      stages: buildStages('ord-f-i1', [
        { code: 'supply', status: 'in_progress' },
        { code: 'cutting', status: 'waiting', deps: [0] },
      ]),
    },
  ],
  materials: [
    {
      id: 'ord-f-m1', order_id: 'ord-f', item_id: null, kind: 'fabric',
      name: 'Футер петля, серый', source: 'purchase', qty: '90 кг',
      qty_expected: 90, status: 'received', eta_date: null, received_at: FX_CREATED,
      notes: null, created_at: FX_CREATED, updated_at: FX_CREATED,
    },
    {
      id: 'ord-f-m2', order_id: 'ord-f', item_id: null, kind: 'labels',
      name: 'Бирки картонные', source: 'purchase', qty: '60 шт',
      qty_expected: 60, status: 'pending', eta_date: '2026-07-25', received_at: null,
      notes: null, created_at: FX_CREATED, updated_at: FX_CREATED,
    },
  ],
};

const EXTRA = { orders: [ORDER_NO_MATERIALS, ORDER_PARTIAL] };

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page, EXTRA);
  await page.clock.setFixedTime(FIXED_TIME);
});

/**
 * Строка ИМЕННО очереди закупки.
 *
 * Область обязательна: ниже на том же экране стоит таблица закупочных строк,
 * и в ней у того же заказа своя строка на каждый материал. Проверка без области
 * находила три элемента и падала на strict mode — но хуже другое: она могла бы
 * пройти на строке ТАБЛИЦЫ МАТЕРИАЛОВ, то есть на том самом реестре, из-за
 * которого заказ без материалов и был невидим.
 */
const supplyRow = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('region', { name: 'Заказы в закупке' })
    .getByRole('row')
    .filter({ hasText: title });

test.describe('Очередь закупки (правка 12.08)', () => {
  test('заказ БЕЗ материалов виден и говорит об этом прямо', async ({ page }) => {
    await page.goto('/purchasing?studio=0');

    const block = page.getByRole('heading', { name: /Заказы в закупке/ });
    await expect(block).toBeVisible();

    // Это и есть дефект: раньше такого заказа не было ни на одном экране
    const row = supplyRow(page, 'Платки тест закупка');
    await expect(row).toBeVisible();
    await expect(row).toContainText('материалы не заведены');
  });

  test('строка списка — ЗАКАЗ, а не этап и не материал', async ({ page }) => {
    await page.goto('/purchasing?studio=0');

    // У заказа одна позиция → один этап закупки. Строка обязана быть одна,
    // а число этапов — отдельной колонкой: заказ из трёх позиций дал бы
    // три одинаковые строки с одним и тем же списком материалов
    const rows = supplyRow(page, 'Платки тест закупка');
    await expect(rows).toHaveCount(1);
    // Число позиций в закупке переехало в карточку вместе с работой (п. 1.1):
    // в списке остались только ключевые поля навигации
    await rows.first().getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByText(/1 позиция в закупке/)).toBeVisible();
  });

  test('состояние закупки различает «ожидает» и «в работе»', async ({ page }) => {
    await page.goto('/purchasing?studio=0');

    await expect(supplyRow(page, 'Платки тест закупка')).toContainText('Ожидает');
    await expect(supplyRow(page, 'Худи корпоратив')).toContainText('В работе');
  });

  test('материалы показаны прогрессом «N из M»', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    await expect(supplyRow(page, 'Худи корпоратив')).toContainText('1 из 2');
  });

  /**
   * РАБОЧИХ ДЕЙСТВИЙ В СПИСКЕ НЕТ (п. 1.2): «не держать россыпью в общем
   * списке — они доступны после открытия конкретной закупки». Сторожим
   * отсутствие поимённо: вернувшаяся кнопка восстановила бы вторую рабочую
   * зону молча.
   */
  test('список — только навигация, действия в карточке', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    const row = supplyRow(page, 'Платки тест закупка');
    for (const name of ['Печать', '+ Материал', 'Взять в работу', 'Завершить закупку']) {
      await expect(row.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(row.getByRole('button', { name: 'Открыть' })).toBeVisible();
  });

  /** Сводка статусов видна сразу, без прокрутки к таблице (п. 1.3) */
  test('карточка закупки открывается со сводкой статусов', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    await supplyRow(page, 'Платки тест закупка')
      .getByRole('button', { name: 'Открыть' }).click();
    // Выбор живёт в адресе — ссылкой на закупку можно поделиться
    await expect(page).toHaveURL(/supply=/);
    // Ищем именно ПЛИТКИ сводки: «Пришло» и «В пути» есть ещё и среди
    // чипов-фильтров таблицы, которая лежит в той же карточке
    const tiles = page.locator('[class*="kpiCardLabel"]');
    for (const label of ['Всего материалов', 'Не заказано', 'Заказано', 'В пути', 'Пришло', 'Проблемы']) {
      await expect(tiles.filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
  });

  test('досрочное закрытие требует причины — иначе этап закрыт молча', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    await supplyRow(page, 'Платки тест закупка')
      .getByRole('button', { name: 'Открыть' }).click();
    await page.getByRole('button', { name: 'Завершить закупку' }).click();

    // У заказа нет ни одного материала → закрытие досрочное и с объяснением
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('не заведено ни одного материала');
    const input = dialog.getByLabel('Почему закупка завершена');
    await expect(input).toBeVisible();

    // Подтвердить без причины нельзя: через неделю «почему» должно отвечать
    // не расследование, а история этапа
    await expect(dialog.getByRole('button', { name: 'Завершить' })).toBeDisabled();
    await input.fill('Материалы давальческие');
    await expect(dialog.getByRole('button', { name: 'Завершить' })).toBeEnabled();
  });

  /**
   * АРХИВ ЗАВЕРШЁННЫХ ЗАКУПОК (правка заказчика 24.08, п. 2).
   *
   * Жалоба была тройная: завершённые заказы «раскрыты и мешают», внутри
   * архива второй раз стоит заголовок «Заказы в закупке», а статус у них
   * «Ожидает». Unit-стороже проверяют список и `supplyState`; здесь —
   * то, чего они не видят: что блок стоит ПОСЛЕ рабочей области экрана
   * и что раскрытый архив не заводит второй такой же заголовок.
   */
  test('архив свёрнут, стоит после рабочей области и не дублирует заголовок',
    async ({ page }) => {
      await page.goto('/purchasing?studio=0');
      const active = page.getByRole('heading', { name: /Заказы в закупке/ });
      await expect(active).toBeVisible();

      const archive = page.locator('details').filter({ hasText: 'Завершённые закупки' }).first();
      // Свёрнут по умолчанию: содержимое в аккессибилити-дерево не попадает
      await expect(archive.getByRole('button', { name: 'Открыть' })).toHaveCount(0);

      // Внизу страницы: заголовок активной очереди выше архива по документу
      const order = await active.evaluate(
        (el, arc) => el.compareDocumentPosition(arc!) & Node.DOCUMENT_POSITION_FOLLOWING,
        await archive.elementHandle(),
      );
      expect(order, 'архив обязан стоять ниже рабочей области').toBeGreaterThan(0);

      await archive.locator('summary').click();
      await expect(archive.getByRole('button', { name: 'Открыть' }).first()).toBeVisible();
      // Второго «Заказы в закупке» не появилось — ни заголовком, ни именем области
      await expect(active).toHaveCount(1);
      await expect(page.getByRole('region', { name: 'Заказы в закупке' })).toHaveCount(1);
    });

  test('завершённая закупка помечена «Завершено», а не «Ожидает»', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    const archive = page.locator('details').filter({ hasText: 'Завершённые закупки' }).first();
    await archive.locator('summary').click();
    const rows = page.getByRole('region', { name: 'Завершённые закупки' }).getByRole('row');
    // Шапка таблицы тоже строка — берём первую с кнопкой «Открыть»
    const row = rows.filter({ has: page.getByRole('button', { name: 'Открыть' }) }).first();
    await expect(row).toContainText('Завершено');
    await expect(row).not.toContainText('Ожидает');
  });

  /**
   * ПОЛЕ КОЛИЧЕСТВА В ФОРМЕ ОДНО (правка заказчика 30.08, п. 8): «убрать поле
   * „Нужное количество" из формы создания закупки. Оставить только поле
   * „Количество к заказу"».
   *
   * Прежняя пара полей отвечала на один вопрос: строку заводит сам закупщик,
   * и планировать себе же ему нечего — второе поле ехало за первым
   * подстановкой и правилось хорошо если раз на сотню строк.
   *
   * ВЕЛИЧИНА `qty_expected` ПРИ ЭТОМ ПИШЕТСЯ (см. `submit` в
   * `FabricPurchasing`): это знаменатель приёмки на складе и условие
   * автозакрытия закупки, и строка без него не закроется автоматически
   * НИКОГДА. Убрано ПОЛЕ, а не величина.
   */
  test('в форме одно поле количества — «Количество к заказу»',
    async ({ page }) => {
      await page.goto('/purchasing?studio=0');
      // Форма живёт в карточке ВЫБРАННОГО заказа (мастер-деталь с правки 23.08):
      // строку заводят конкретному заказу, а не в общий реестр
      await supplyRow(page, 'Худи корпоратив')
        .getByRole('button', { name: 'Открыть' }).click();
      await page.getByRole('button', { name: '+ Материал' }).click();

      const modal = page.getByRole('dialog', { name: 'Новая закупка' });
      await expect(modal.getByLabel('Количество к заказу')).toBeVisible();
      await expect(modal.getByLabel('Нужно количество')).toHaveCount(0);

      await modal.getByLabel('Количество к заказу').fill('110');
      await expect(modal.getByLabel('Количество к заказу')).toHaveValue('110');
    });

  /**
   * СТАТУС «ЗАКАЗАНО» НЕ ВЫБИРАЕТСЯ (тот же п. 1): он ставится по факту —
   * заполненным количеством к заказу и датой заказа. Пункт остаётся видимым,
   * но недоступным: исчезнувшая строка списка читается как поломка.
   */
  test('«Заказано» в списке статусов виден, но недоступен', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    await supplyRow(page, 'Худи корпоратив')
      .getByRole('button', { name: 'Открыть' }).click();
    const select = page.getByLabel(/^Статус /).first();
    await expect(select).toBeVisible();
    await expect(select.getByRole('option', { name: /^Заказано/ })).toBeDisabled();
    await expect(select.getByRole('option', { name: 'В пути' })).toBeEnabled();
  });

  test('бейдж «Закупка» в меню считает заказы, ждущие закупки', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    const link = page.getByRole('complementary').getByRole('link', { name: /Закупка/ });
    await expect(link).toBeVisible();
    // Два заказа с открытым этапом supply; дозакупок из брака в фикстуре нет.
    // Раньше счётчик считал ТОЛЬКО дозакупки — и в разделе никто не появлялся
    await expect(link).toContainText('2');
  });
});
