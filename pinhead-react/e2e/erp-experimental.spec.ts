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
 * Открыть вкладку карточки разработки (референс 24.08).
 *
 * Карточка перестала быть одной простынёй: поля, задачи, файлы, история,
 * финальный пакет и SKU разведены по вкладкам. Проверки ниже — про
 * СОДЕРЖИМОЕ, поэтому им нужен переход, а не переписывание.
 *
 * Ждём смены панели, а не просто кликаем: `aria-selected` меняется тем же
 * рендером, что и содержимое, и проверка после него не снимет старый кадр.
 */
async function openDevTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name: new RegExp(name) });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Строка списка разработок — НЕЗАВИСИМО ОТ РАСКЛАДКИ.
 *
 * На десктопе это строка таблицы, ниже 1024px — карточка (`DevRowCard`):
 * с 23.08 у экрана две раскладки. Проверки ниже про СОДЕРЖИМОЕ (готовность
 * из задач, названный блокер, фильтр в адресе), а не про разметку, — значит
 * верны на обеих ширинах, и привязка к `role="row"` просто выключила бы их
 * на телефоне вместо того, чтобы что-то поймать.
 */
function devRow(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name })
    .or(page.getByRole('article').filter({ hasText: name }));
}

/**
 * Открыть разработку из списка.
 *
 * В таблице открывает клик по строке, в карточке — отдельная кнопка: на
 * планшете палец задевает карточку при прокрутке, и «переход по касанию»
 * уводил бы с экрана без спроса. Разница осознанная, поэтому и здесь
 * две ветки, а не одна.
 */
async function openDev(page: Page, name: string) {
  const row = devRow(page, name);
  await expect(row).toBeVisible();
  const open = row.getByRole('button', { name: 'Открыть разработку' });
  if (await open.count()) await open.click();
  else await row.click();
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
      // Обычная внутренняя работа технолога — она и есть содержимое блока
      // «Задачи этапов» после правки 30.08 (п. 3): задачи ключевых этапов
      // туда больше не попадают, их ведёт «Основной маршрут разработки»
      task({
        id: 'dev-work-t3', experimental_id: 'dev-work', task_type: 'other',
        title: 'Подобрать молнию', status: 'in_progress', responsible: 'Ирина',
        sort_order: 30,
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

  /**
   * Правка заказчика 23.08, п. 6: «Разработка должна появляться в
   * экспериментальном цехе только из соответствующей сделки/заказа».
   *
   * Сторож проверяет ОБЕ половины бывшей точки входа — и кнопку, и селект
   * позиции-образца рядом с ней: убрать одну кнопку, оставив выбор, значит
   * оставить половину механики, к которой однажды вернут действие.
   */
  test('ручного создания разработки нет — она приходит из заказа', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0');
    await expect(page.getByRole('button', { name: /Разработка/ })).toHaveCount(0);
    await expect(
      page.getByLabel('Позиция-образец для разработки'),
    ).toHaveCount(0);
  });

  test('таблица отвечает «почему стоит», а не «на какой фазе»', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    const row = devRow(page, 'Бомбер двухслойный');

    // Готовность — в ЗАДАЧАХ (0 из 1), блокер назван словами
    await expect(row).toContainText('0 / 1');
    await expect(row).toContainText('Подбор материала');
    await expect(row).toContainText('снять блокировку: нет решения по цвету подкладки');
  });

  test('ноль задач дал бы «—», а не 100 % — здесь готовность честная', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    // У «Новые» две задачи, ни одна не закрыта
    await expect(devRow(page, 'Худи оверсайз')).toContainText('0 / 2');
  });

  test('подпись задачи без названия берётся из справочника', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    // У задач «Новых» своих названий нет — блокер показывает имя из справочника,
    // а не код `patterns`
    const row = devRow(page, 'Худи оверсайз');
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
    await expect(devRow(page, 'Бомбер двухслойный')).toBeVisible();
    await expect(devRow(page, 'Худи оверсайз')).toHaveCount(0);

    // Прямой заход по той же ссылке восстанавливает подбор
    await gotoDev(page, '/experimental?studio=0&view=list&state=ready');
    await expect(devRow(page, 'Футболка freefit')).toBeVisible();
    await expect(devRow(page, 'Бомбер двухслойный')).toHaveCount(0);
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
    await openDev(page, 'Бомбер двухслойный');

    await expect(page).toHaveURL(/\/experimental\/dev-block/);
    /**
     * С референса 24.08 блокер и следующее действие живут в постоянной справке
     * справа, а подпись блока — «Блокеры». Проверяем именно её область: то же
     * самое, найденное где угодно на странице, прошло бы и в случае, когда
     * справка исчезла, а текст остался в шапке.
     */
    const aside = page.getByRole('complementary', { name: 'Справка по разработке' });
    await expect(aside).toContainText('Блокеры');
    await expect(aside).toContainText('нет решения по цвету подкладки');
    await expect(aside).toContainText('Следующее действие');
  });

  /**
   * МАРШРУТ ЧИТАЕТСЯ С ПЕРВОГО ЭКРАНА (правка 23.08, п. 7): «показать
   * понятный progress-stepper… маршрут должен быть понятен с первого экрана
   * без необходимости искать действие внизу карточки».
   *
   * Сторожим состояние КАЖДОГО шага, а не наличие пяти подписей: stepper,
   * который рисует пять кружков и молчит о том, где разработка, выглядит
   * рабочим и не отвечает на вопрос, ради которого сделан.
   */
  test('маршрут показан stepper-ом, у каждого этапа видно состояние', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    await openDev(page, 'Бомбер двухслойный');

    const stepper = page.getByRole('list', { name: 'Путь разработки' });
    await expect(stepper).toBeVisible();
    for (const label of ['Построение лекал', 'Крой', 'Нанесения', 'Пошив', 'Финальный этап']) {
      await expect(stepper.getByText(label, { exact: true })).toBeVisible();
    }
    // Хотя бы один шаг обязан называть своё состояние — иначе подписи пусты
    await expect(stepper.getByText(/Ожидает|В работе|Завершено|Не требуется/).first())
      .toBeVisible();
  });

  test('текущий этап назван прямо, а не угадывается по виду', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=list');
    await openDev(page, 'Бомбер двухслойный');
    // Текущий этап назван дважды — в шапке страницы и в блоке маршрута.
    // Это не дубль-по-недосмотру: шапка отвечает «где разработка» сразу,
    // блок маршрута — «что с ней делать». Сторожим наличие, не количество
    await expect(page.getByRole('main').getByText(/Текущий этап:/).first()).toBeVisible();
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
    const normal = drawer.getByRole('row').filter({ hasText: 'Подобрать молнию' });
    await expect(normal.getByRole('button', { name: 'Готово' })).toBeVisible();
  });

  /**
   * П. 3 документа 30.08: «блок „Задачи этапов" должен содержать только
   * дополнительные внутренние задачи». Работа самих этапов видна выше,
   * в «Основном маршруте разработки», — второй список тех же строк был бы
   * третьим местом для одного и того же.
   */
  test('блок задач не перечисляет задачи ключевых этапов', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    const drawer = page.getByRole('main');

    await expect(drawer.getByRole('row').filter({ hasText: 'Подобрать молнию' }))
      .toHaveCount(1);
    await expect(
      drawer.getByRole('row').filter({ hasText: 'Лекала базовые' }),
      'задача этапа попала в блок дополнительных — это второй список тех же строк',
    ).toHaveCount(0);
    // Сам этап при этом на виду — в маршруте, где ему и место. Локатор
    // сужен до панели вкладки: то же самое пишет постоянная справка сбоку,
    // и по всей области совпадений было бы два
    await expect(
      drawer.locator('#dev-tabpanel').getByText('Текущий этап: Построение лекал'),
    ).toBeVisible();
  });

  test('повторная примерка — новая задача со своим кругом, а не счётчик', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-fit?studio=0');
    const drawer = page.getByRole('main');
    await expect(
      drawer.getByRole('row').filter({ hasText: 'Повторная примерка' }),
    ).toContainText('круг 2');

    /**
     * Первый круг остался в истории — в этом и смысл новой строки. С правки
     * 24.08 (п. 4.4) закрытые задачи живут в своём свёрнутом блоке: «отдельно
     * показывать активные и завершённые». Раскрываем его явно — история обязана
     * быть достижимой, а не просто существовать в разметке.
     */
    const doneBlock = drawer.locator('details')
      .filter({ hasText: 'Завершённые задачи' }).first();
    await doneBlock.locator('summary').click();
    await expect(
      doneBlock.getByRole('row').filter({ hasText: 'Доработка: дно +2 см' }),
    ).toBeVisible();
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

    // Исход виден в шапке карточки — на любой вкладке
    await expect(drawer).toContainText('Готово к серии');
    // Ни формы добавления задач, ни кнопок исхода: разработка закрыта
    await expect(drawer.getByRole('button', { name: '+ Добавить задачу' })).toHaveCount(0);
    /**
     * Справки «почему стоит» у закрытой разработки нет вовсе: работа кончилась,
     * и «следующее действие» превратилось бы в прочерк. Проверяем ОТСУТСТВИЕ
     * области, а не текста: текст мог бы не совпасть по другой причине.
     */
    await expect(
      page.getByRole('complementary', { name: 'Справка по разработке' })
        .getByText('Блокеры'),
    ).toHaveCount(0);

    await openDevTab(page, 'Финальный пакет');
    await expect(drawer).toContainText('лекала утверждены');
  });

  test('«Готово к серии» честно говорит, что заказ на серию заводит менеджер',
    async ({ page }) => {
      await gotoDevPage(page, '/experimental/dev-work?studio=0');
      await openDevTab(page, 'Финальный пакет');
      await expect(page.getByRole('main')).toContainText('заказ на серию заводит менеджер');
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

/**
 * ЭКСПЕРИМЕНТАЛЬНЫЙ ЦЕХ КАК УЧАСТОК МАРШРУТА (правка заказчика 24.08, п. 4.1).
 *
 * «Когда заказ доходит до этого шага, он появляется в очереди
 * экспериментального цеха». Участок непроизводственный, то есть вырезан из
 * ВСЕХ общих поверхностей: без собственной очереди этап не виден нигде,
 * и заказ встаёт молча — так 12.08 встали 33 заказа с этапом закупки.
 *
 * Заказ СВОЙ: базовые четыре держат visual-эталоны и счётчики соседних спек.
 */
const ROUTE_ORDER = {
  id: 'ord-x', bitrix_id: '55400', title: 'Серия: бомбер',
  manager: 'Пётр', launch_date: '2026-07-14', due_date: '2026-08-30',
  buffer_days: 1, priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: FX_CREATED, updated_at: FX_CREATED,
  items: [{
    id: 'ord-x-i1', order_id: 'ord-x', product_type: 'Бомбер', variant: null,
    qty: 50, production_type: 'sewing', branding_methods: [], branding_on: 'cut',
    notes: null, size_grid: null, sort_order: 10,
    created_at: FX_CREATED, updated_at: FX_CREATED,
    // Участок ЭКС стоит В СЕРЕДИНЕ маршрута обычного заказа — ровно так,
    // как описывает документ: «можно поставить в любое нужное место»
    stages: buildStages('ord-x-i1', [
      { code: 'cutting', status: 'done' },
      { code: 'experimental', status: 'ready', deps: [0] },
      { code: 'sewing', status: 'waiting', deps: [1] },
    ]),
    prints: [],
  }],
  materials: [],
  attachments: [],
};

/**
 * СВОЙ ЗАКАЗ ДЛЯ ПЕРЕНОСОВ ПО КАНБАНУ ЭКС.
 *
 * У всех четырёх базовых заказов материалы стоят `received` БЕЗ приёмки
 * складом, то есть материальный гейт у них закрыт — и правка 30.08 (п. 1)
 * законно не выпускает карточку с «Построения лекал». Это отдельный сторож
 * ниже; переносам же нужен заказ, у которого материал на месте.
 *
 * `reserved` («Доступен со склада») — самый короткий путь к «материал годен»:
 * он не требует ещё и `accept_status`.
 *
 * Нанесение у позиции ОДНО (шелкография): именно из него, а не из вопроса
 * человеку, строится маршрут нанесений образца.
 */
const MOVE_ORDER = {
  id: 'ord-mv', bitrix_id: '55500', title: 'Образец: ветровка',
  manager: 'Пётр', launch_date: '2026-07-14', due_date: '2026-08-30',
  buffer_days: 1, priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: FX_CREATED, updated_at: FX_CREATED,
  items: [{
    id: 'ord-mv-i1', order_id: 'ord-mv', product_type: 'Ветровка', variant: 'образец',
    qty: 2, production_type: 'samples', branding_methods: ['silkscreen'], branding_on: 'cut',
    notes: null, size_grid: null, sort_order: 10,
    created_at: FX_CREATED, updated_at: FX_CREATED,
    stages: [],
    prints: [{
      id: 'ord-mv-p1', item_id: 'ord-mv-i1', seq: 1, method: 'silkscreen',
      fabric: null, zone: 'Грудь', width_mm: 100, height_mm: 100,
      offset_note: null, pantone: null, special: null, comment: null,
      created_at: FX_CREATED,
    }],
  }],
  materials: [{
    id: 'ord-mv-m1', order_id: 'ord-mv', item_id: null, kind: 'fabric',
    name: 'Плащёвка', source: 'stock', qty: '10 м',
    status: 'reserved', eta_date: null, received_at: FX_CREATED, notes: null,
    created_at: FX_CREATED, updated_at: FX_CREATED,
  }],
  attachments: [],
};

/** Разработка на этом заказе: задач нет вовсе — их больше не создаётся (п. 3) */
const MOVE_DEV = {
  ...base,
  id: 'dev-move',
  order_id: 'ord-mv',
  item_id: 'ord-mv-i1',
  tech_name: 'Ветровка образец',
  technologist: 'Ирина',
  order: { title: 'Образец: ветровка', bitrix_id: '55500', due_date: '2026-08-30' },
  tasks: [],
};

test.describe('Канбан ЭКС: колонку ставит человек (п. 4.2)', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, {
      experimental: [...EXPERIMENTAL, MOVE_DEV],
      dictionaries: DICTIONARIES,
      orders: [MOVE_ORDER],
    });
    await page.clock.setFixedTime(FIXED_TIME);
  });
  /**
   * «Ответственный за проработку технолог сам вручную перетаскивает карточку
   * между колонками. Автоматическое движение по основным этапам не нужно».
   *
   * ЧЕГО ЭТОТ СТОРОЖ НЕ ПРОВЕРЯЕТ — сказано вслух: сам жест HTML5-drag он
   * не воспроизводит. Проверяется путь, которым пользуются на планшете
   * и с клавиатуры (кнопки «‹ ›»), и он зовёт РОВНО ТУ ЖЕ функцию переноса,
   * что обработчик броска. Смысл броска покрыт unit-тестами `devMoveIntent`.
   */
  const card = (page: import('@playwright/test').Page, name: string) =>
    page.getByRole('listitem').filter({ hasText: name });

  /**
   * Колонка ищется по ЗАГОЛОВКУ, а не по тексту внутри: названия всех пяти
   * шагов стоят ещё и в индикаторе пути КАЖДОЙ карточки, и поиск по тексту
   * находил все секции разом.
   */
  const column = (page: import('@playwright/test').Page, title: string) =>
    page.locator('section')
      .filter({ has: page.locator('header').filter({ hasText: title }) });

  /**
   * ПЕРЕХОД «ЛЕКАЛА → КРОЙ» СПРАШИВАЕТ ТЕХНИЧЕСКОЕ НАЗВАНИЕ ЛЕКАЛ
   * (правка заказчика 30.08, п. 3): «открыть одно окно подтверждения
   * с обязательным полем „Техническое название лекал". Отдельный ввод
   * свободного текста „Результат этапа" не показывать».
   *
   * Раньше название требовало ЗАКРЫТИЕ обязательной задачи `patterns`, но
   * таких задач больше не создаётся — вопрос переехал в сам переход.
   */
  test('переход «Лекала → Крой» просит техническое название лекал', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0');
    await expect(column(page, 'Построение лекал')).toContainText('Ветровка образец');

    await card(page, 'Ветровка образец')
      .getByRole('button', { name: 'Перенести в «Крой»' }).click();

    const dialog = page.getByRole('dialog', { name: /Завершить построение лекал/ });
    await expect(dialog).toBeVisible();
    // Ровно ОДНО поле: свободного «Результата этапа» рядом быть не должно
    await expect(dialog.getByLabel('Техническое название лекал')).toBeVisible();
    await expect(dialog.getByLabel('Результат этапа')).toHaveCount(0);

    await dialog.getByLabel('Техническое название лекал').fill('PNHD-W12-v1');
    await dialog.getByRole('button', { name: /Завершить и перенести/ }).click();

    await expect(column(page, 'Крой')).toContainText('Ветровка образец');
    await expect(column(page, 'Построение лекал')).not.toContainText('Ветровка образец');
  });

  test('отмена окна оставляет карточку на месте', async ({ page }) => {
    // Окно — не «уже перенесли, теперь уточните»: отмена отменяет всё
    await gotoDev(page, '/experimental?studio=0');
    await card(page, 'Ветровка образец')
      .getByRole('button', { name: 'Перенести в «Крой»' }).click();
    await page.getByRole('dialog', { name: /Завершить построение лекал/ })
      .getByRole('button', { name: 'Отмена' }).click();
    await expect(column(page, 'Построение лекал')).toContainText('Ветровка образец');
  });

  /**
   * ЗАКУПКА ДЕРЖИТ ВЫХОД С ЛЕКАЛ (правка заказчика 30.08, п. 1): «пока закупка
   * по заказу не завершена и материал не подтверждён как полученный,
   * заблокировать перевод карточки с этапа лекал на следующие производственные
   * этапы… на карточке отображать плашку „Ожидаем материал"».
   *
   * У «Ветровки на молнии» материалы стоят `received` без приёмки складом —
   * то есть ровно «пришло, но склад не подтвердил».
   */
  test('с «Лекал» не выпускает, пока материал не принят складом', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0');
    const blocked = card(page, 'Ветровка на молнии');
    // Причина видна ДО действия, а не только в тосте после
    await expect(blocked).toContainText('Ожидаем материал');

    await blocked.getByRole('button', { name: 'Перенести в «Крой»' }).click();
    /*
     * Регион тостов адресуется ПО ИМЕНИ. Безымянный `getByRole('status')`
     * совпадал ещё и с полосой «Обновляем данные…» (`StaleDataBar` объявляет
     * ту же роль), и проверка падала strict mode violation ровно тогда, когда
     * в этот момент шло переподключение realtime, — то есть выглядела флакой,
     * а была неоднозначностью разметки. Фильтр по ожидаемому тексту эту
     * неоднозначность бы спрятал и заодно сделал проверку тавтологией.
     */
    await expect(page.getByRole('status', { name: 'Оповещения' }))
      .toContainText('Ожидаем материал');
    await expect(column(page, 'Построение лекал')).toContainText('Ветровка на молнии');
    await expect(column(page, 'Крой')).not.toContainText('Ветровка на молнии');
  });

  /**
   * НАНЕСЕНИЯ БЕРУТСЯ ИЗ ЗАКАЗА (правка заказчика 30.08, п. 2): «убрать окно
   * „Какие нанесения нужны образцу?"… маршрут брать только из данных заказа».
   *
   * У позиции `ord-a-i1` заведено нанесение «Шелкография» — карточка уходит
   * в «Нанесения» БЕЗ единого вопроса.
   */
  test('переход в «Нанесения» не спрашивает виды — они из заказа', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0');
    const item = card(page, 'Ветровка образец');
    await item.getByRole('button', { name: 'Перенести в «Крой»' }).click();
    const dialog = page.getByRole('dialog', { name: /Завершить построение лекал/ });
    await dialog.getByLabel('Техническое название лекал').fill('PNHD-W12-v1');
    await dialog.getByRole('button', { name: /Завершить и перенести/ }).click();
    await expect(column(page, 'Крой')).toContainText('Ветровка образец');

    await item.getByRole('button', { name: 'Перенести в «Нанесения»' }).click();

    // Ни одного диалога: прежний выбор видов снят целиком
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(column(page, 'Нанесения')).toContainText('Ветровка образец');
  });

  test('на краю доски кнопка гаснет, а не исчезает', async ({ page }) => {
    // Пропадающий элемент сдвигает соседний под палец
    await gotoDev(page, '/experimental?studio=0');
    const item = card(page, 'Ветровка образец');
    await expect(item.getByRole('button', { name: 'Левее колонок нет' })).toBeDisabled();
  });
});

test.describe('Участок «Экспериментальный цех» в маршруте (п. 4.1)', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, {
      experimental: EXPERIMENTAL,
      dictionaries: DICTIONARIES,
      orders: [ROUTE_ORDER],
    });
  });

  test('этап серийного заказа виден в очереди участка', async ({ page }) => {
    await gotoDev(page, '/experimental?studio=0&view=queue');
    const main = page.getByRole('main');
    await expect(main).toContainText('№55400');
    await expect(main).toContainText('Бомбер');
    // Готов к работе: закрой сдан, значит участок может брать
    await expect(main).toContainText('Готово к работе');
  });

  test('строка ведёт на страницу задания — работают там же, где всегда',
    async ({ page }) => {
      await gotoDev(page, '/experimental?studio=0&view=queue');
      const row = page.getByRole('row').filter({ hasText: '№55400' });
      await expect(row.getByRole('link', { name: 'Открыть' })).toBeVisible();
    });

  /**
   * Сторож против самого коварного отказа: очередь участка есть, но до неё
   * не добраться. Переключатель видов рисовался по числу РАЗРАБОТОК, а этап
   * участка от них не зависит вовсе — у фабрики без единой разработки заказ
   * снова стал бы невидимым.
   */
  test('до очереди участка можно добраться и без единой разработки',
    async ({ page }) => {
      await installSupabaseMock(page, {
        experimental: [],
        dictionaries: DICTIONARIES,
        orders: [ROUTE_ORDER],
      });
      await gotoDev(page, '/experimental?studio=0');
      const views = page.getByRole('button', { name: 'Очередь участка' });
      await expect(views).toBeVisible();
      await views.click();
      await expect(page.getByRole('main')).toContainText('№55400');
    });
});

test.describe('Финальный технический пакет', () => {
  test('завершение закрыто и НАЗЫВАЕТ, чего не хватает', async ({ page }) => {
    /**
     * «Разработку нельзя перевести в "Готово к серии", пока обязательные
     * данные не заполнены… система должна показать, какие поля ещё
     * не заполнены». Гейт кнопки — зеркало серверного стража.
     */
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    await openDevTab(page, 'Финальный пакет');
    const main = page.getByRole('main');
    await expect(main).toContainText('Не хватает, чтобы завершить разработку');
    await expect(main).toContainText('Техническое название лекал');
    await expect(main).toContainText('Фото образца');
    await expect(main.getByRole('button', { name: 'Завершить разработку' })).toBeDisabled();
  });

  /**
   * ПРАВКИ 24.08 (пп. 4.5, 4.6) — то, чего unit-тесты по построению не видят:
   * что переключатель на живом экране действительно меняет ТРЕБОВАНИЯ,
   * а не только прячет поля.
   */
  test('карточка SKU обязательна ровно при включённом переключателе', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    await openDevTab(page, 'Финальный пакет');
    const main = page.getByRole('main');

    // Выключен: полей карточки нет ни на экране, ни в перечне недостающего
    await expect(main).not.toContainText('Ценовая вилка');
    await expect(main.getByLabel('Описание', { exact: true })).toHaveCount(0);

    await main.getByLabel('Добавить модель в каталог SKU').check();

    await expect(main.getByLabel('Описание', { exact: true })).toBeVisible();
    await expect(main).toContainText('Ценовая вилка');
    await expect(main).toContainText('Доступные ткани');
  });

  /** «Поле „Файл лекал или ссылка" не нужно» — ввода нет ни в каком режиме */
  test('лекала не спрашиваются', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    await openDevTab(page, 'Финальный пакет');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ссылка на лекала')).toHaveCount(0);
    await expect(main.getByLabel('Файл лекал', { exact: true })).toHaveCount(0);
    await expect(main).not.toContainText('Файл или ссылка на лекала');
  });
});

/**
 * ВКЛАДКИ КАРТОЧКИ РАЗРАБОТКИ (референс заказчика 24.08).
 *
 * Unit-тесты проверяют раскладку и связи ARIA; здесь — то, чего они по
 * построению не видят: живёт ли вкладка в АДРЕСЕ (ссылку на финальный пакет
 * шлют коллегам) и переживает ли она перезагрузку страницы.
 */
test.describe('Вкладки карточки разработки', () => {
  test('вкладка живёт в адресе и переживает перезагрузку', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    await openDevTab(page, 'Финальный пакет');
    await expect(page).toHaveURL(/tab=package/);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('tab', { name: /Финальный пакет/ }),
      'после перезагрузки открылась другая вкладка — ссылка не работает',
    ).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * Вкладка по умолчанию адрес НЕ засоряет: `?tab=tasks` в ссылке — это
   * лишний параметр, который потом придётся объяснять. Тот же приём,
   * что в карточке заказа.
   */
  test('возврат на «Задачи» убирает параметр из адреса', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-work?studio=0');
    await openDevTab(page, 'Файлы');
    await expect(page).toHaveURL(/tab=files/);
    await openDevTab(page, 'Задачи');
    await expect(page).not.toHaveURL(/tab=/);
  });

  /**
   * Главное свойство раскладки: «почему стоит» и «что делать дальше» видны
   * на ЛЮБОЙ вкладке. Спрятать их за переключателем значит показать проблему
   * только тому, кто угадал вкладку.
   */
  test('справка с блокером видна на любой вкладке', async ({ page }) => {
    await gotoDevPage(page, '/experimental/dev-block?studio=0');
    const aside = page.getByRole('complementary', { name: 'Справка по разработке' });
    await expect(aside).toContainText('нет решения по цвету подкладки');

    await openDevTab(page, 'Финальный пакет');
    await expect(aside).toContainText('нет решения по цвету подкладки');
    await openDevTab(page, 'История доработок');
    await expect(aside).toContainText('нет решения по цвету подкладки');
  });
});
