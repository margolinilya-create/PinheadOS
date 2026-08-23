import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installSupabaseMock, buildStages, deptId, FX_CREATED } from './support/mockSupabase';

/**
 * Переход на ЭКРАН РАЗДЕЛА с ожиданием, что экран смонтирован.
 *
 * `page.goto` дожидается загрузки МОДУЛЕЙ, но не инициализации приложения:
 * сессия и `loadBootstrap` идут после `load`, а экран ленивый. Проверка,
 * снятая сразу после `goto`, читает оболочку без содержимого — и держится
 * только на том, что экран обычно успевает. Заголовок раздела рисует сам
 * экран (`PageHead`), оболочка его не рисует.
 */
async function gotoDev(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Экспериментальный цех' })).toBeVisible();
}

/**
 * То же для СТРАНИЦЫ РАЗРАБОТКИ (`/experimental/<id>`, правка 22.08, п. 4.11).
 * Заголовок здесь — название разработки, а не раздела, поэтому ждём первый
 * заголовок страницы: он появляется вместе с её содержимым.
 */
async function gotoDevPage(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/**
 * Экспериментальный цех: задачи вместо фаз (ТЗ заказчика 12.08).
 *
 * ЧТО ЭТО СТОРОЖИТ. Прежняя модель была цепочкой из пяти фаз, и заказчик назвал
 * её главной логической ошибкой: разработка не линейна. Теперь фазы НЕ ХРАНЯТСЯ
 * вовсе — верхние плитки экрана это ВЫЧИСЛЯЕМЫЕ состояния, а хранится только
 * исход. Unit-тесты покрывают саму функцию `devState`; здесь проверяется то,
 * чего они не видят: сходятся ли счётчики плиток с содержимым таблицы, живёт ли
 * подбор в адресе и остаётся ли задача, отданная в цех, действительно
 * на чтение.
 *
 * Последнее — не косметика: статус такой задачи ведёт триггер
 * `erp_experimental_task_sync`, и кнопка «Готово» здесь означала бы второго
 * писателя одной колонки.
 *
 * Разработки свои: базовый мок отдаёт пустой список, а дописывать их в общие
 * фикстуры значит менять дашборд и бейдж сайдбара всем соседним спекам.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

const base = {
  measurement_table: null,
  has_3d: false,
  constructor: null,
  technologist: null,
  outcome: null,
  outcome_comment: null,
  closed_at: null,
  dev_type: null,
  priority: 0,
  due_date: null,
  comment: null,
  created_at: FX_CREATED,
  updated_at: FX_CREATED,
};

const task = (over: Record<string, unknown>) => ({
  title: null,
  responsible: null,
  due_date: null,
  status: 'todo',
  blocked_reason: null,
  depends_on: [],
  cycle: 0,
  sort_order: 10,
  qty: null,
  comment: null,
  result: null,
  department_id: null,
  stage_id: null,
  done_on: null,
  created_at: FX_CREATED,
  updated_at: FX_CREATED,
  ...over,
});

/**
 * Пять разработок — по одной на каждое состояние. Состояние НЕ хранится:
 * оно должно получиться само из набора задач, и в этом смысл фикстуры.
 */
const EXPERIMENTAL = [
  {
    // «Новые»: задачи заведены, но ни одна не начата
    ...base,
    id: 'dev-new',
    order_id: 'ord-b',
    item_id: 'ord-b-i1',
    tech_name: 'Худи оверсайз, лекала',
    order: { title: 'Форма официантов «Веранда»', bitrix_id: '54900', due_date: '2026-07-22' },
    tasks: [
      task({ id: 'dev-new-t1', experimental_id: 'dev-new', task_type: 'patterns', sort_order: 10 }),
      task({ id: 'dev-new-t2', experimental_id: 'dev-new', task_type: 'material', sort_order: 20 }),
    ],
  },
  {
    // «В работе»: одна задача идёт, вторая отдана в цех (её ведёт триггер)
    ...base,
    id: 'dev-work',
    order_id: 'ord-a',
    item_id: 'ord-a-i1',
    tech_name: 'Ветровка на молнии',
    technologist: 'Ирина',
    order: { title: 'BOX39 худи чёрные', bitrix_id: '54766', due_date: '2026-07-30' },
    tasks: [
      task({
        id: 'dev-work-t1', experimental_id: 'dev-work', task_type: 'patterns',
        title: 'Лекала базовые', status: 'in_progress', responsible: 'Ирина', sort_order: 10,
      }),
      task({
        id: 'dev-work-t2', experimental_id: 'dev-work', task_type: 'branding',
        title: 'Нанесение образца', status: 'waiting', sort_order: 20,
        department_id: deptId('dtf'), stage_id: 'ord-a-i1-st3', qty: 2,
      }),
    ],
  },
  {
    // «Требуют внимания»: есть заблокированная задача
    ...base,
    id: 'dev-block',
    order_id: 'ord-c',
    item_id: 'ord-c-i1',
    tech_name: 'Бомбер двухслойный',
    constructor: 'Сергей',
    order: { title: 'Мерч конференции DevConf', bitrix_id: '55010', due_date: '2026-08-05' },
    tasks: [
      task({
        id: 'dev-block-t1', experimental_id: 'dev-block', task_type: 'material',
        title: 'Подбор материала', status: 'blocked',
        blocked_reason: 'нет решения по цвету подкладки', sort_order: 10,
      }),
    ],
  },
  {
    // «На примерке»: открыта задача типа `fitting`, и это ВТОРОЙ круг
    ...base,
    id: 'dev-fit',
    order_id: 'ord-d',
    item_id: 'ord-d-i1',
    tech_name: 'Шоппер с усиленным дном',
    order: { title: 'Шопперы эко «Маркет»', bitrix_id: '55120', due_date: '2026-08-10' },
    tasks: [
      task({
        id: 'dev-fit-t1', experimental_id: 'dev-fit', task_type: 'rework',
        title: 'Доработка: дно +2 см', status: 'done', sort_order: 10,
      }),
      task({
        id: 'dev-fit-t2', experimental_id: 'dev-fit', task_type: 'fitting',
        title: 'Повторная примерка', status: 'in_progress', cycle: 1, sort_order: 20,
        depends_on: ['dev-fit-t1'],
      }),
    ],
  },
  {
    // «Готовы к серии»: хранится ТОЛЬКО исход
    ...base,
    id: 'dev-ready',
    order_id: 'ord-d',
    item_id: null,
    tech_name: 'Футболка freefit',
    outcome: 'ready_for_serial',
    outcome_comment: 'лекала утверждены',
    closed_at: '2026-07-19T10:00:00Z',
    order: { title: 'Шопперы эко «Маркет»', bitrix_id: '55120', due_date: '2026-08-10' },
    tasks: [
      task({
        id: 'dev-ready-t1', experimental_id: 'dev-ready', task_type: 'patterns',
        status: 'done', sort_order: 10,
      }),
    ],
  },
];

/**
 * Справочник типов задач: у задачи без своего названия подпись берётся отсюда.
 * Пустой справочник показал бы код (`patterns`) — путь рабочий, но не основной.
 */
const DICTIONARIES = [
  {
    id: 'd1', kind: 'experimental_task_type', code: 'patterns', name: 'Лекала',
    sort_order: 10, active: true, meta: {}, created_at: FX_CREATED, updated_at: FX_CREATED,
  },
  {
    id: 'd2', kind: 'experimental_task_type', code: 'material', name: 'Подбор материала',
    sort_order: 20, active: true, meta: {}, created_at: FX_CREATED, updated_at: FX_CREATED,
  },
  {
    id: 'd3', kind: 'experimental_task_type', code: 'fitting', name: 'Примерка',
    sort_order: 30, active: true, meta: {}, created_at: FX_CREATED, updated_at: FX_CREATED,
  },
];

/**
 * Заказ-образец СО СВОИМ этапом нанесения (`origin: 'experimental'`).
 *
 * Отдельный заказ, а не правка базовых четырёх: те держат visual-эталоны
 * и счётчики очередей `erp-queue`/`erp-plan`, и добавленный этап сдвинул бы
 * чужие проверки. Правило спек: свои данные — вторым аргументом мока.
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

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page, { experimental: EXPERIMENTAL, dictionaries: DICTIONARIES });
  await page.clock.setFixedTime(FIXED_TIME);
});

/** Плитка-состояние по подписи; счётчик — её последнее число */
const tile = (page: import('@playwright/test').Page, label: string) =>
  page.getByRole('button').filter({ hasText: label });

test.describe('Экран разработки: состояния считаются, а не хранятся', () => {
  test('плитки раскладывают разработки по вычисленным состояниям', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0');
    await expect(page.getByRole('heading', { name: 'Экспериментальный цех' })).toBeVisible();

    // Ни одно из этих состояний не лежит в БД: они получены из набора задач
    for (const label of ['Новые', 'В работе', 'Требуют внимания', 'На примерке', 'Готовы к серии']) {
      await expect(tile(page, label).first()).toContainText('1');
    }
    await expect(tile(page, 'Все').first()).toContainText('5');
  });

  test('таблица отвечает «почему стоит», а не «на какой фазе»', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    const row = page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' });

    // Готовность — в ЗАДАЧАХ (0 из 1), блокер назван словами
    await expect(row).toContainText('0 / 1');
    await expect(row).toContainText('Подбор материала');
    await expect(row).toContainText('снять блокировку: нет решения по цвету подкладки');
  });

  test('ноль задач дал бы «—», а не 100 % — здесь готовность честная', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    // У «Новые» две задачи, ни одна не закрыта
    await expect(
      page.getByRole('row').filter({ hasText: 'Худи оверсайз' }),
    ).toContainText('0 / 2');
  });

  test('подпись задачи без названия берётся из справочника', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    // У задач «Новых» своих названий нет — блокер показывает имя из справочника,
    // а не код `patterns`
    const row = page.getByRole('row').filter({ hasText: 'Худи оверсайз' });
    await expect(row).toContainText('Лекала');
    await expect(row).not.toContainText('patterns');
  });

  test('фильтр по состоянию живёт в адресе — ссылкой можно поделиться', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    await tile(page, 'Требуют внимания').first().click();

    await expect(page).toHaveURL(/state=attention/);
    /**
     * ВЫБРАННЫЙ ВИД ОБЯЗАН ПЕРЕЖИТЬ ФИЛЬТР. `setFilters` заменял весь набор
     * параметров, поэтому клик по плитке сбрасывал `view=list` — человек,
     * выбравший «Список», молча оказывался на доске.
     *
     * Проверка стоит ПЕРЕД поиском строки не для красоты: ассерт на строку
     * снимался со СТАРОГО кадра и потому проходил четыре раза из пяти, пряча
     * дефект. Адрес перепроверяется сам и ждёт настоящей перерисовки.
     */
    await expect(page, 'клик по фильтру сбросил выбранный вид').toHaveURL(/view=list/);
    await expect(page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Худи оверсайз' })).toHaveCount(0);

    // Прямой заход по той же ссылке восстанавливает подбор
    await gotoDev(page, '/experimental?studio=0&view=list&state=ready');
    await expect(page.getByRole('row').filter({ hasText: 'Футболка freefit' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' })).toHaveCount(0);
  });
});

/**
 * Карточка разработки — СТРАНИЦА, а не боковая шторка (правка заказчика
 * 22.08, п. 4.11): «для такого количества информации это неудобно».
 * Поэтому здесь больше нет `getByRole('dialog')` — содержимое живёт
 * прямо на странице `/experimental/<id>`.
 */
test.describe('Карточка разработки', () => {
  test('открывается страницей и показывает блокер и следующее действие', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    await page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' }).click();

    await expect(page).toHaveURL(/\/experimental\/dev-block/);
    const card = page.getByRole('main');
    await expect(card).toContainText('Текущий блокер');
    await expect(card).toContainText('нет решения по цвету подкладки');
    await expect(card).toContainText('Следующее действие');
  });

  /**
   * Ссылки на шторку живут в переписке и закладках — молча показать список
   * вместо запрошенной карточки значит потерять человека на ровном месте.
   */
  test('старая ссылка ?dev= переадресует на страницу', async ({ page }) => {
    /**
     * ЕДИНСТВЕННЫЙ переход БЕЗ `gotoDev`, и это осознанно: здесь проверяется
     * САМА ПЕРЕАДРЕСАЦИЯ, а экран раздела — промежуточное состояние, которого
     * может не быть вовсе. Ожидание его заголовка сделало бы тест зависимым
     * от того, успел ли список отрисоваться до редиректа: локально успевал
     * (223 теста зелёные), на раннере CI — нет.
     *
     * Обе проверки ниже ПЕРЕПРОВЕРЯЕМЫЕ (`expect(page)`, `expect(locator)`),
     * поэтому своего ожидания им не нужно: адрес — что редирект случился,
     * заголовок — что страница действительно смонтирована, а не просто
     * сменился URL.
     */
    await page.goto('/experimental?studio=0&dev=dev-work');
    await expect(page).toHaveURL(/\/experimental\/dev-work/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('задача, отданная в цех, — только на чтение: её статус ведёт триггер', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    const drawer = page.getByRole('main');
    const delegated = drawer.getByRole('row').filter({ hasText: 'Нанесение образца' });

    await expect(delegated).toContainText('Передано в цех: ДТФ');
    // Ни одной кнопки статуса — иначе у колонки два писателя
    await expect(delegated.getByRole('button', { name: 'Готово' })).toHaveCount(0);
    await expect(delegated.getByRole('button', { name: 'Заблокировать' })).toHaveCount(0);
    await expect(delegated.getByRole('button', { name: 'В цех' })).toHaveCount(0);
    // Вместо кнопок — ссылка на само задание, где работает цех
    await expect(delegated.getByRole('link', { name: 'задание цеха' })).toBeVisible();

    // А у обычной задачи кнопки на месте — сравнение обязательно, иначе проверка
    // выше прошла бы и на экране, где кнопок нет ни у кого
    const normal = drawer.getByRole('row').filter({ hasText: 'Лекала базовые' });
    await expect(normal.getByRole('button', { name: 'Готово' })).toBeVisible();
  });

  test('повторная примерка — новая задача со своим кругом, а не счётчик', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-fit?studio=0');
    const drawer = page.getByRole('main');
    await expect(
      drawer.getByRole('row').filter({ hasText: 'Повторная примерка' }),
    ).toContainText('круг 2');
    // Первый круг остался в истории — в этом и смысл новой строки
    await expect(drawer.getByRole('row').filter({ hasText: 'Доработка: дно +2 см' })).toBeVisible();
  });

  test('доработка спрашивает ОБЛАСТИ и называет последствия', async ({ page }) => {
    /**
     * Правки 20.08: «указывается, что именно нужно изменить… после этого
     * повторно запускаются только необходимые этапы». Прежняя кнопка
     * «Примерка не принята» заводила жёсткую тройку задач независимо
     * от причины — вышивку перезапускали из-за длины рукава.
     */
    await gotoDevPage(page, '/experimental/dev-fit?studio=0');
    const drawer = page.getByRole('main');
    await drawer.getByRole('button', { name: 'Требуется доработка' }).click();

    await drawer.getByRole('checkbox', { name: 'Лекала' }).check();
    await drawer.getByLabel('Что исправить').fill('рукав +2 см');

    // Последствия видны ДО нажатия и считаются той же функцией, что и задачи
    await expect(drawer).toContainText('доработка лекал');
    await expect(drawer).toContainText('новый крой');
    await expect(drawer).toContainText('Нанесение повторно НЕ запускается');
  });

  test('закрытая разработка не предлагает действий — хранится только исход', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-ready?studio=0');
    const drawer = page.getByRole('main');

    await expect(drawer).toContainText('Готово к серии');
    await expect(drawer).toContainText('лекала утверждены');
    // Ни формы добавления задач, ни кнопок исхода: разработка закрыта
    await expect(drawer.getByRole('button', { name: '+ Добавить задачу' })).toHaveCount(0);
    await expect(drawer).not.toContainText('Текущий блокер');
  });

  test('«Готово к серии» честно говорит, что заказ на серию заводит менеджер',
    async ({ page }) => {
      await gotoDevPage(page, '/experimental/dev-work?studio=0');
      const drawer = page.getByRole('main');
      await expect(drawer).toContainText('заказ на серию заводит менеджер');
    });
});

/**
 * Доска по этапам — ГЛАВНЫЙ экран раздела (правки заказчика 20.08).
 *
 * «Главный экран должен быть построен по этапам, по тому же принципу, как
 * сейчас выглядит общий производственный борд… Колонки: Построение лекал ·
 * Крой · Нанесения · Пошив · Финальный этап».
 */
test.describe('Доска экспериментального цеха', () => {
  test('пять колонок документа, и «Нанесения» ОДНА', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0');
    /**
     * Ищем ЗАГОЛОВОК КОЛОНКИ — «название + счётчик», а не любое совпадение
     * текста: те же слова стоят в переключателе видов, и проверка «просто
     * видно» проходила бы даже на пустой доске.
     */
    for (const col of ['Построение лекал', 'Крой', 'Нанесения', 'Пошив', 'Финальный этап']) {
      await expect(
        page.getByText(new RegExp(`^${col}\\s*\\d+$`)).first(),
      ).toBeVisible();
    }
    // Отдельного ВТО документ запрещает прямо: «оно выполняется внутри работы
    // экс цеха без создания отдельной колонки и отдельной очереди».
    // Смотрим ТОЛЬКО на доску: в сайдбаре ВТО есть и остаётся — это общий цех
    await expect(page.getByRole('main').getByText('ВТО', { exact: true })).toHaveCount(0);
  });

  test('разработка стоит в колонке своего шага, а не там, где её положили',
    async ({ page }) => {
      await gotoDev(page, '/experimental?studio=0');
      // Колонка ВЫЧИСЛЯЕТСЯ из задач: у «Ветровки» идут лекала, у «Футболки»
      // зафиксирован исход — она в финальном этапе
      const board = page.locator('section').filter({ hasText: 'Построение лекал' }).first();
      await expect(board).toContainText('Ветровка на молнии');
    });

  test('вид раздела живёт в адресе — ссылкой можно поделиться', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0');
    await page.getByRole('button', { name: 'Лекала', exact: true }).click();
    await expect(page).toHaveURL(/view=patterns/);

    // Собственная очередь ЭКС: задачи лекал по ВСЕМ разработкам
    const row = page.getByRole('row').filter({ hasText: 'Лекала базовые' });
    await expect(row).toContainText('Ветровка на молнии');
    await expect(row).toContainText('Ирина');
  });

  test('нанесения — отфильтрованное ОБЩЕЕ задание с пометкой образца',
    async ({ page }) => {
      /**
       * «Задачи нанесений не дублируются… одновременно отображается в общем
       * цехе и в экс цехе». Поэтому здесь читаются ЭТАПЫ, те же самые, что
       * видит цех, — отобранные по `origin`.
       *
       * Заказ СВОЙ: базовые четыре держат visual-эталоны и счётчики очередей,
       * и подмешивать в них этап образца значило бы править чужие проверки.
       */
      await installSupabaseMock(page, {
        experimental: EXPERIMENTAL,
        dictionaries: DICTIONARIES,
        orders: [SAMPLE_ORDER],
      });
      await gotoDev(page, '/experimental?studio=0&view=dtf');
      await expect(page.getByText('ЭКС / ОБРАЗЕЦ').first()).toBeVisible();
      await expect(page.getByRole('link', { name: /Открыть/ }).first()).toBeVisible();
    });
});

test.describe('Финальный технический пакет', () => {
  test('«Готово к серии» закрыто и НАЗЫВАЕТ, чего не хватает', async ({ page }) => {
    /**
     * «Разработку нельзя перевести в "Готово к серии", пока обязательные
     * данные не заполнены… система должна показать, какие поля ещё
     * не заполнены». Гейт кнопки — зеркало серверного стража.
     */
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    const drawer = page.getByRole('main');
    await expect(drawer).toContainText('Не хватает для «Готово к серии»');
    await expect(drawer).toContainText('Техническое название лекал');
    await expect(drawer).toContainText('Фото образца');
    await expect(drawer).toContainText('Ценовая вилка');
    await expect(drawer.getByRole('button', { name: 'Готово к серии' })).toBeDisabled();
  });
});
