import { test, expect } from '@playwright/test';
import { installSupabaseMock, deptId, FX_CREATED } from './support/mockSupabase';

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

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page, { experimental: EXPERIMENTAL, dictionaries: DICTIONARIES });
  await page.clock.setFixedTime(FIXED_TIME);
});

/** Плитка-состояние по подписи; счётчик — её последнее число */
const tile = (page: import('@playwright/test').Page, label: string) =>
  page.getByRole('button').filter({ hasText: label });

test.describe('Экран разработки: состояния считаются, а не хранятся', () => {
  test('плитки раскладывают разработки по вычисленным состояниям', async ({ page }) => {
    await page.goto('/experimental?studio=0');
    await expect(page.getByRole('heading', { name: 'Экспериментальный цех' })).toBeVisible();

    // Ни одно из этих состояний не лежит в БД: они получены из набора задач
    for (const label of ['Новые', 'В работе', 'Требуют внимания', 'На примерке', 'Готовы к серии']) {
      await expect(tile(page, label).first()).toContainText('1');
    }
    await expect(tile(page, 'Все разработки').first()).toContainText('5');
  });

  test('таблица отвечает «почему стоит», а не «на какой фазе»', async ({ page }) => {
    await page.goto('/experimental?studio=0');
    const row = page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' });

    // Готовность — в ЗАДАЧАХ (0 из 1), блокер назван словами
    await expect(row).toContainText('0 / 1');
    await expect(row).toContainText('Подбор материала');
    await expect(row).toContainText('снять блокировку: нет решения по цвету подкладки');
  });

  test('ноль задач дал бы «—», а не 100 % — здесь готовность честная', async ({ page }) => {
    await page.goto('/experimental?studio=0');
    // У «Новые» две задачи, ни одна не закрыта
    await expect(
      page.getByRole('row').filter({ hasText: 'Худи оверсайз' }),
    ).toContainText('0 / 2');
  });

  test('подпись задачи без названия берётся из справочника', async ({ page }) => {
    await page.goto('/experimental?studio=0');
    // У задач «Новых» своих названий нет — блокер показывает имя из справочника,
    // а не код `patterns`
    const row = page.getByRole('row').filter({ hasText: 'Худи оверсайз' });
    await expect(row).toContainText('Лекала');
    await expect(row).not.toContainText('patterns');
  });

  test('фильтр по состоянию живёт в адресе — ссылкой можно поделиться', async ({ page }) => {
    await page.goto('/experimental?studio=0');
    await tile(page, 'Требуют внимания').first().click();

    await expect(page).toHaveURL(/state=attention/);
    await expect(page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Худи оверсайз' })).toHaveCount(0);

    // Прямой заход по той же ссылке восстанавливает подбор
    await page.goto('/experimental?studio=0&state=ready');
    await expect(page.getByRole('row').filter({ hasText: 'Футболка freefit' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' })).toHaveCount(0);
  });
});

test.describe('Карточка разработки', () => {
  test('открывается в адресе и показывает блокер и следующее действие', async ({ page }) => {
    await page.goto('/experimental?studio=0');
    await page.getByRole('row').filter({ hasText: 'Бомбер двухслойный' }).click();

    await expect(page).toHaveURL(/dev=dev-block/);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('Текущий блокер');
    await expect(drawer).toContainText('нет решения по цвету подкладки');
    await expect(drawer).toContainText('Следующее действие');
  });

  test('задача, отданная в цех, — только на чтение: её статус ведёт триггер', async ({ page }) => {
    await page.goto('/experimental?studio=0&dev=dev-work');
    const drawer = page.getByRole('dialog');
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
    await page.goto('/experimental?studio=0&dev=dev-fit');
    const drawer = page.getByRole('dialog');
    await expect(
      drawer.getByRole('row').filter({ hasText: 'Повторная примерка' }),
    ).toContainText('круг 2');
    // Первый круг остался в истории — в этом и смысл новой строки
    await expect(drawer.getByRole('row').filter({ hasText: 'Доработка: дно +2 см' })).toBeVisible();
  });

  test('«Примерка не принята» обещает новый круг, а не возврат к фазе', async ({ page }) => {
    await page.goto('/experimental?studio=0&dev=dev-fit');
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: 'Примерка не принята' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Примерка не принята?' });
    await expect(dialog).toContainText('три задачи нового круга');
    await expect(dialog.getByLabel('Что исправить')).toBeVisible();
  });

  test('закрытая разработка не предлагает действий — хранится только исход', async ({ page }) => {
    await page.goto('/experimental?studio=0&dev=dev-ready');
    const drawer = page.getByRole('dialog');

    await expect(drawer).toContainText('Готово к серии');
    await expect(drawer).toContainText('лекала утверждены');
    // Ни формы добавления задач, ни кнопок исхода: разработка закрыта
    await expect(drawer.getByRole('button', { name: '+ Добавить задачу' })).toHaveCount(0);
    await expect(drawer).not.toContainText('Текущий блокер');
  });

  test('«Готово к серии» честно говорит, что заказ на серию заводит менеджер',
    async ({ page }) => {
      await page.goto('/experimental?studio=0&dev=dev-work');
      const drawer = page.getByRole('dialog');
      await expect(drawer).toContainText('производственный заказ на серию заводит менеджер');
    });
});
