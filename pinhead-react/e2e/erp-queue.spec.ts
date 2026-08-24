import { test, expect } from '@playwright/test';
import { installSupabaseMock, buildStages } from './support/mockSupabase';

/**
 * Волна 1 «Ядро диспетчера»: постоянное меню цехов, компактная очередь из трёх
 * блоков, приоритеты, страница производственного задания, переходы в заказ,
 * кликабельные показатели закупки.
 *
 * Гоняется против dev-сервера с dev-автологином и замоканным Supabase
 * (support/mockSupabase.ts) — реальной БД не требуется. Время заморожено,
 * чтобы сроки в фикстурах не дрейфовали.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

test.describe('Навигация ERP (правки 1 и 13)', () => {
  test('в сайдбаре есть группа «Цеха» со всеми участками', async ({ page }) => {
    await page.goto('/?studio=0');
    const sidebar = page.getByRole('complementary');
    // Сначала ждём сам пункт меню: заголовок группы появляется вместе с сайдбаром,
    // и проверка его видимости первой ловила гонку монтирования под нагрузкой
    for (const name of ['Закрой', 'Шелкография', 'ДТФ', 'Вышивка', 'Швейка', 'ВТО']) {
      await expect(sidebar.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(sidebar.getByText('Цеха', { exact: true })).toBeVisible();
  });

  test('пункт цеха открывает его рабочую очередь', async ({ page }) => {
    await page.goto('/?studio=0');
    await page.getByRole('link', { name: /Швейка/ }).click();
    await expect(page).toHaveURL(/\/queue\/sewing/);
    await expect(page.getByRole('heading', { name: 'Швейный цех' })).toBeVisible();
  });

  test('логотип возвращает на главную из любого раздела', async ({ page }) => {
    await page.goto('/orders?studio=0');
    const brand = page.getByRole('link', { name: 'На главную ERP' });
    await expect(brand).toBeVisible();
    // Кликабелен весь блок, а не только буква: в ссылку входит и иконка, и надпись
    await expect(brand.getByText('PINHEAD ERP')).toBeVisible();
    await brand.click();
    await expect(page.getByRole('heading', { name: 'Обзор производства' })).toBeVisible();
  });
});

test.describe('Рабочая очередь цеха (правки 2, 3, 9)', () => {
  /**
   * ПОРЯДОК БЛОКОВ (правка 23.08, п. 3): «Готово к запуску → В работе →
   * Ожидает → Ожидают материалы (свёрнуто) → Завершено недавно (свёрнуто)».
   * Главный принцип документа — «в верхней части очереди всегда находятся
   * заказы, с которыми цех может работать сейчас».
   *
   * Сравниваются ФАКТИЧЕСКИ найденные заголовки: у цеха без единого
   * ожидающего задания группы «Ожидает» не будет вовсе, и требовать её
   * значило бы сторожить фикстуру, а не правило.
   */
  test('очередь показывает блоки в порядке требования', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueRow"]').first()).toBeVisible();
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.first()).toBeVisible();
    const titles = (await headings.allTextContents())
      .map((t) => t.replace(/\s+/g, ' ').trim());
    const seq = ['Готово к запуску', 'В работе', 'Ожидает', 'Ожидают материалы', 'Завершено недавно']
      .map((t) => titles.findIndex((x) => x.includes(t)))
      .filter((i) => i >= 0);
    expect(seq.length).toBeGreaterThan(0);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    expect(titles.some((t) => t.includes('Завершено недавно'))).toBe(true);
  });

  /**
   * Обе группы ожидания свёрнуты при ПЕРВОМ открытии (пп. 2.3 и 3.5):
   * «Ожидают материалы» — заголовок, счётчик и действие «Показать».
   *
   * Сторожим именно СВЁРНУТОСТЬ, а не наличие кнопки: кнопка была бы на месте
   * и у раскрытого блока, а жалоба документа ровно про то, что он раскрыт
   * и занимает основную часть экрана.
   */
  test('«Ожидают материалы» свёрнуты при первом открытии', async ({ page }) => {
    await installSupabaseMock(page, { orders: [SUPPLY_WAIT_ORDER] });
    await page.goto('/queue/cutting?studio=0');
    const heading = page.getByRole('heading', { level: 2 })
      .filter({ hasText: 'Ожидают материалы' });
    const toggle = heading.getByRole('button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Показать');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Свернуть');
  });

  /**
   * ГРАНИЦА ДВУХ ОЖИДАНИЙ, ради которой всё и переделано (пп. 2 и 3).
   *
   * Незакрытая ЗАКУПКА — снабжение, а не производство: у закроя ожидание
   * почти всегда такое, поэтому группа «Ожидает» остаётся пустой, и на экране
   * оказывается ОДНА свёрнутая группа ожидания внизу — ровно то, что просит
   * п. 2 («нет отдельного верхнеуровневого блока „Ожидают материалы"»),
   * без единой поцеховой настройки.
   */
  test('ожидание закупки — снабжение, и у закроя группа ожидания одна', async ({ page }) => {
    await installSupabaseMock(page, { orders: [SUPPLY_WAIT_ORDER] });
    await page.goto('/queue/cutting?studio=0');
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.first()).toBeVisible();
    const titles = (await headings.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    expect(titles.some((t) => t.includes('Ожидают материалы'))).toBe(true);
    // Именно ОДНА: «Ожидает» без своих заданий не рисуется вовсе
    expect(titles.filter((t) => t.trim().startsWith('Ожидает'))).toEqual([]);
    // Причина не потерялась — она в карточке задания
    await page.getByRole('heading', { level: 2 })
      .filter({ hasText: 'Ожидают материалы' }).getByRole('button').click();
    await expect(page.getByText('Закупка: ещё не завершено').first()).toBeVisible();
  });

  test('строка очереди показывает заказ, срок, статус и готовность', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    const row = page.locator('[class*="queueRow"]').first();
    await expect(row).toBeVisible();
    // Номер заказа кликабелен прямо из очереди (правка 6)
    const orderLink = row.getByRole('link', { name: /№\d+/ });
    await expect(orderLink).toBeVisible();
    // Подсказка даёт то, что НЕ видно: обрезанное многоточием название целиком.
    // Раньше title дублировал номер, который и так на экране (хвост долгов).
    await expect(orderLink).toHaveAttribute('title', /№\d+ · .+/);
    await expect(row.getByRole('link', { name: 'Открыть' })).toBeVisible();
    // Количество, срок, исполнитель и процент готовности — в одной строке
    await expect(row.getByText(/\d+ шт/)).toBeVisible();
    await expect(row.getByTitle('Исполнитель')).toBeVisible();
    await expect(row.getByTitle(/Сделано \d+ из \d+ шт/)).toBeVisible();
  });

  test('фильтры сбрасываются и сохраняются в адресе', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await page.getByRole('button', { name: /Просрочено/ }).click();
    await expect(page).toHaveURL(/overdue=1/);
    // exact: имя ищется подстрокой, а в пустом состоянии очереди есть своя
    // кнопка «Сбросить фильтры» — без exact локатор находит обе и падает
    // на strict mode. Здесь проверяется именно сброс из панели фильтров.
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await expect(page).not.toHaveURL(/overdue=1/);
  });
});

test.describe('Страница производственного задания (правки 5 и 6)', () => {
  test('открывается из очереди и показывает заказ, клиента и маршрут', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await page.locator('[class*="queueRow"]').first().getByRole('link', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(/\/task\//);
    await expect(page.getByRole('link', { name: /Открыть заказ №/ })).toBeVisible();
    await expect(page.getByText('Клиент', { exact: true })).toBeVisible();
    await expect(page.getByText('Маршрут и прогресс')).toBeVisible();
    await expect(page.getByRole('link', { name: '← В очередь цеха' })).toBeVisible();
  });
});

test.describe('Производственный канбан (правка 4)', () => {
  test('колонки — производственные процессы', async ({ page }) => {
    await page.goto('/board?studio=0');
    await page.getByRole('button', { name: /Канбан/ }).click();
    const board = page.getByRole('list', { name: 'Канбан по цехам' });
    await expect(board).toBeVisible();
    const heads = board.locator('section > :first-child');
    await expect(heads.first()).toBeVisible();
    const names = (await heads.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    for (const dept of ['Закрой', 'Шелкография', 'ДТФ', 'Вышивка', 'Швейка', 'ВТО']) {
      expect(names.some((n) => n.startsWith(dept))).toBe(true);
    }
    // Дорожки внутри процесса — «Готово к работе» / «В работе» / «Завершено»
    await expect(board.getByText('Готово к работе').first()).toBeVisible();
  });
});

/**
 * Открыть карточку закупки первого доступного заказа.
 *
 * С правки 23.08 (п. 1) экран — мастер-деталь: материалы живут в карточке
 * ВЫБРАННОГО заказа. Часть фикстур не имеет открытых этапов закупки, и там
 * заказы лежат в свёрнутом блоке «Завершённые» (п. 1.6).
 *
 * Заголовок списка дожидаемся ЯВНО: он рисуется только по `loaded`, и без
 * этого `count()` ниже отработал бы на ещё пустом экране — клика не было бы
 * вовсе, а упал бы уже следующий шаг.
 */
async function openPurchaseCard(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: /Заказы в закупке/ })).toBeVisible();
  const archive = page.locator('summary').filter({ hasText: 'Завершённые закупки' });
  if (await archive.count()) await archive.first().click();
  await page.getByRole('button', { name: 'Открыть' }).first().click();
}

test.describe('Показатели закупки (правки 10 и 14)', () => {
  /**
   * ПЛИТОК-ПОКАЗАТЕЛЕЙ ЭКРАНА БОЛЬШЕ НЕТ (правка 23.08, п. 1.3): они были
   * вторым видом того же фильтра, что чипы, и тем самым «общим статусом
   * материалов ниже по экрану», на который жалуется документ. Фильтр остался
   * чипами, статус переехал в сводку карточки — проверяется в `erp-supply`.
   */
  test('фильтр таблицы живёт чипами и сбрасывается', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    await openPurchaseCard(page);
    await expect(page.getByRole('button', { name: /Всего строк/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Ожидается/ }).first().click();
    await expect(page.getByText(/Фильтр: Ожидается/)).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
    await expect(page.getByText(/Фильтр: Ожидается/)).toHaveCount(0);
  });
});

test.describe('Админка: права и справочники (правки 11 и 12)', () => {
  test('вкладки админки включают «Права» и «Справочники»', async ({ page }) => {
    await page.goto('/admin?studio=0');
    const tabs = page.getByRole('tablist', { name: 'Разделы админки' });
    for (const name of [
      'Пользователи', 'Права', 'Цеха', 'Мощность', 'Справочники', 'Аварийный режим', 'Заказы ТЗ',
    ]) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }
  });

  /**
   * Мощность производства (правки 10.08): 10 000 единиц в месяц задаются одним
   * числом, а дневная и месячная доступность СЧИТАЮТСЯ из рабочих дней —
   * фиксированного значения на день документ запрещает прямо.
   */
  test('мощность: одно число, остальное считается из рабочих дней', async ({ page }) => {
    await page.goto('/admin?tab=capacity&studio=0');
    await expect(page.getByRole('spinbutton')).toHaveValue('10000');
    // Июль 2026: 23 рабочих дня при пятидневке → 10000/23 ≈ 435 в день
    await expect(page.getByText('рабочих дней в месяце:')).toContainText('23');
    await expect(page.getByText('доступно в день:')).toContainText('435');
    // Кнопка гаснет, пока ничего не изменили: сохранять нечего
    await expect(page.getByRole('button', { name: 'Сохранить мощность' })).toBeDisabled();
    await page.getByRole('spinbutton').fill('12000');
    await expect(page.getByRole('button', { name: 'Сохранить мощность' })).toBeEnabled();
    await expect(page.getByText('доступно в день:')).toContainText('522');
  });

  /**
   * Аварийный режим (правки 10.08): вкладка есть, форма просит причину и не даёт
   * снять проверку без неё. Кнопка без причины — это снятие «просто так»,
   * а разбираться в нём завтра будет некому.
   */
  test('аварийный режим: вкладка открывается и требует причину', async ({ page }) => {
    await page.goto('/admin?tab=bypass&studio=0');
    await expect(page.getByRole('heading', { name: 'Снять проверку' })).toBeVisible();
    await expect(page.getByText('Все проверки действуют.')).toBeVisible();

    const submit = page.getByRole('button', { name: 'Снять проверку' });
    await expect(submit).toBeDisabled();
    await page.getByPlaceholder('напр. склад не может провести приёмку из-за ошибки')
      .fill('склад не проводит приёмку');
    await expect(submit).toBeEnabled();
  });

  test('матрица прав — чекбокс на каждое право и роль', async ({ page }) => {
    await page.goto('/admin?tab=roles&studio=0');
    await expect(page.getByText('Матрица отвечает на вопрос')).toBeVisible();
    // Рядовой сотрудник цеха завершает этап, но не меняет приоритеты (дефолт сида)
    await expect(page.getByRole('checkbox', { name: 'Завершать этап — Сотрудник цеха' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Менять приоритеты — Сотрудник цеха' })).not.toBeChecked();
    // Роль переименована под фактическую структуру команды (правки 10.08):
    // «Бригадир» → «Мастер цеха», он отвечает сразу за закрой и швейку
    await expect(page.getByRole('checkbox', { name: 'Менять приоритеты — Мастер цеха' })).toBeChecked();
  });

  test('справочники: под-вкладки и статусы только для чтения', async ({ page }) => {
    await page.goto('/admin?tab=dicts&studio=0');
    const tabs = page.getByRole('tablist', { name: 'Справочники' });
    for (const name of ['Причины блокировок', 'Типы проблем', 'Типы изделий', 'Поставщики', 'Статусы']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }
    await tabs.getByRole('tab', { name: 'Статусы' }).click();
    await expect(page.getByText(/Переименовать их из админки нельзя/)).toBeVisible();
  });

  test('цеха: редактор с руководителем и нормативом', async ({ page }) => {
    await page.goto('/admin?tab=depts&studio=0');
    await expect(page.getByRole('button', { name: '+ Добавить участок' })).toBeVisible();
    /**
     * Проверка колонок — перепроверяемая (`expect(locator)`), а не одноразовый
     * `allTextContents()`.
     *
     * Кнопка «+ Добавить участок» живёт в панели НАД таблицей и появляется
     * раньше неё: до 22.08 таблица рисовалась всегда — пустая, с одной шапкой,
     * — и заголовки были на месте сразу. Теперь она закрыта условием `loaded`
     * (правило UX-2: пока данные едут, показывается скелетон, а не пустая
     * шапка), и одноразовый счёт успевал снять список ДО отрисовки.
     * Дефект вскрылся, когда прогон ускорился с 25 минут до 4: раньше каждый
     * тест ждал шрифты с CDN, и этого хватало, чтобы таблица успела прийти.
     */
    for (const col of ['Участок', 'Порядок', 'Руководитель', 'Норматив, дн']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(col) }),
        `нет колонки «${col}»`,
      ).toBeVisible();
    }
  });
});

test.describe('Варианты поставщиков в закупке (правка 10)', () => {
  test('ячейка поставщика открывает сравнение вариантов', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    // Таблица материалов живёт в карточке выбранного заказа (правка 23.08, п. 1)
    await openPurchaseCard(page);
    const cell = page.getByRole('button', { name: /не выбран|вариант/ }).first();
    await expect(cell).toBeVisible();
    await cell.click();

    const dialog = page.getByRole('dialog', { name: /Поставщики:/ });
    await expect(dialog).toBeVisible();
    // Базовый набор полей сравнения, утверждённый заказчиком
    for (const label of ['Поставщик', 'Цена', 'Наличие', 'Срок поставки, дней', 'Минимальная партия', 'Примечание']) {
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: '+ Добавить вариант' })).toBeDisabled();
    await dialog.getByLabel('Поставщик', { exact: true }).fill('Астра Текстиль');
    await expect(dialog.getByRole('button', { name: '+ Добавить вариант' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('Технические задания в PDF', () => {
  test('форма создания не даёт сабмит без ТЗ и называет позицию', async ({ page }) => {
    await page.goto('/orders?studio=0');
    await page.getByRole('button', { name: '+ Новый заказ' }).click();

    const form = page.locator('form');
    await expect(form.getByRole('button', { name: 'ТЗ в PDF для цехов' })).toBeVisible();

    // Пока позиция не заполнена — маршрута нет, требовать нечего
    await expect(form.getByText('Заполните позицию')).toBeVisible();

    await form.getByLabel('Название *').fill('Проверка ТЗ');
    await form.getByLabel('Изделие *').first().fill('Футболка Regular');
    await form.getByLabel('Кол-во *').first().fill('50');

    // Гейт считает ОДИН файл на позицию, а не комплект назначений по цехам
    await expect(form.getByText('Позиция: Футболка Regular')).toBeVisible();
    const msg = form.getByText(/Невозможно создать заказ/);
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('не загружено ТЗ');
    await expect(msg).toContainText('«Футболка Regular»');
    await expect(form.getByRole('button', { name: 'Создать заказ' })).toBeDisabled();

    // Маршрут показан справкой «кто увидит файл», а не списком выборов по цехам
    const hint = form.locator('[class*="tzAssignRow"]').filter({ hasText: 'ТЗ увидят' }).first();
    await expect(hint).toContainText('Закрой');
    await expect(hint).toContainText('Швейка');
    // Закупка ТЗ не требует — её в справке нет
    await expect(hint).not.toContainText('Закупка');
    // Выпадающих списков назначения не осталось ни одного
    await expect(form.getByRole('combobox', { name: /ТЗ для цеха/ })).toHaveCount(0);
  });

  test('задание цеха показывает ТЗ позиции с кнопкой «Открыть ТЗ»', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    // Заказ B: закрой в работе, общий PDF назначен цеху
    const row = page.locator('[class*="queueRow"]').filter({ hasText: '54900' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'Открыть' }).click();

    await expect(page).toHaveURL(/\/task\//);
    await expect(page.getByText('Форма официантов.pdf').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть ТЗ' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Скачать' }).first()).toBeVisible();
  });

  test('карточка заказа показывает одно ТЗ на весь маршрут позиции', async ({ page }) => {
    // Карточка разбита на вкладки (аудит 03.08.2026): ТЗ живёт в своей,
    // и вкладка открывается прямо из адреса — ссылку шлют коллегам.
    await page.goto('/orders/ord-b?studio=0&tab=tz');
    await expect(page.getByRole('tab', { name: /ТЗ/ })).toHaveAttribute('aria-selected', 'true');

    // Общее ТЗ заказа — и по нему работают все производственные цеха позиции
    await expect(page.getByText('Форма официантов.pdf').first()).toBeVisible();
    await expect(page.getByText('цеха работают по нему').first()).toBeVisible();
    const row = page.locator('[class*="tzAssignRow"]').filter({ hasText: 'По этому ТЗ работают' }).first();
    await expect(row).toContainText('Закрой');
    // Назначать документ цехам больше не нужно — выборов не осталось
    await expect(page.getByRole('combobox', { name: /ТЗ для цеха/ })).toHaveCount(0);
  });
});

/**
 * Карточка заказа — ОТДЕЛЬНАЯ СТРАНИЦА (правка заказчика 16.08).
 *
 * Раньше заказ открывался боковой панелью, и её состояние жило в адресе
 * (`?order=`). Заказчик от панели отказался: в узком окне не помещается
 * маршрут, материалы, ТЗ, файлы и комментарии сразу. Переход стал обычным,
 * и вместе с ним появилась цена, которой у панели не было — экран списка
 * ЗАКРЫВАЕТСЯ, а с ним теряются фильтры, страница и позиция прокрутки,
 * если их не унести в переход явно (`location.state.from`).
 */
test.describe('Карточка заказа открывается страницей', () => {
  test('клик по заказу уводит на его страницу, боковой панели больше нет', async ({ page }) => {
    await page.goto('/orders?studio=0');
    // Ссылка строки названа заголовком заказа, номер — в отдельной колонке
    await page.getByRole('link', { name: /Веранда/ }).first().click();

    await expect(page).toHaveURL(/\/orders\/ord-/);
    await expect(page.getByRole('tab', { name: /Позиции/ })).toBeVisible();
    // Именно панели нет, а не «она пустая»: диалога в дереве быть не должно
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]order=/);
  });

  test('«Назад» возвращает в список, сохраняя вкладку и фильтр', async ({ page }) => {
    await page.goto('/orders?tab=active&filter=urgent&studio=0');
    await page.getByRole('link', { name: /Веранда/ }).first().click();
    await expect(page).toHaveURL(/\/orders\/ord-/);

    await page.goBack();
    await expect(page).toHaveURL(/tab=active/);
    await expect(page).toHaveURL(/filter=urgent/);
  });

  test('ссылка «Заказы» из карточки ведёт туда, откуда пришли, а не в голый список', async ({ page }) => {
    await page.goto('/orders?studio=0&sort=title&dir=desc');
    await page.getByRole('link', { name: /Веранда/ }).first().click();
    await expect(page).toHaveURL(/\/orders\/ord-/);

    // Раньше здесь стоял безусловный `/orders`, и сортировка с фильтрами терялась.
    // Ищем В КАРТОЧКЕ: пункт меню в сайдбаре называется так же и ведёт в голый список
    await page.locator('main').getByRole('link', { name: /^Заказы$/ }).first().click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page).toHaveURL(/dir=desc/);
  });

  test('страница списка живёт в адресе — возврат не бросает на первую', async ({ page }) => {
    // page/size в адресе появились вместе с полноэкранной карточкой: локальный
    // useState умирал вместе с размонтированным списком
    await page.goto('/orders?studio=0&page=2&size=1');
    // Именно ссылка строки таблицы: в шапке и меню есть свои «Заказы»
    await page.locator('table').getByRole('link').first().click();
    await expect(page).toHaveURL(/\/orders\/ord-/);

    await page.goBack();
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/size=1/);
  });

  test('прямая ссылка на заказ открывается и без контекста списка', async ({ page }) => {
    await page.goto('/orders/ord-b?studio=0');
    await expect(page.getByRole('tab', { name: /Позиции/ })).toBeVisible();
    // Пришли по чужой ссылке — возврат ведёт в обычный список
    await expect(page.getByRole('link', { name: /Заказы/ }).first())
      .toHaveAttribute('href', '/orders');
  });
});

/**
 * Волна UX-2: обрыв связи не должен выглядеть как «работы нет».
 * Раньше при упавшем запросе очередь показывала «Выберите свой цех выше»,
 * а список заказов — пустой тулбар без единой строки; повторить было нечем,
 * потому что эффект `if (!loaded) loadAll()` второй раз не срабатывает.
 */
test.describe('Ошибка загрузки (волна UX-2)', () => {
  /** Роняет запрос заказов; вернуть связь — снять флаг из возвращённой функции */
  async function breakOrders(page: import('@playwright/test').Page) {
    let broken = true;
    await page.route('**/rest/v1/erp_orders*', async (route) => {
      if (!broken) return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'network down' }),
      });
    });
    return () => { broken = false; };
  }

  /**
   * Нажать «Повторить» и дождаться, что ошибка ушла.
   *
   * Через toPass, потому что кнопка исчезает ровно в момент успеха: если клик
   * дошёл, а узел уже снят с DOM, Playwright падает с «element was detached».
   * Повторный клик безвреден — это просто ещё одна попытка загрузки.
   */
  async function retryUntilLoaded(
    page: import('@playwright/test').Page,
    failed: import('@playwright/test').Locator,
  ) {
    await expect(async () => {
      const button = page.getByRole('button', { name: 'Повторить' });
      if (await button.count() > 0) await button.first().click({ timeout: 2000 });
      await expect(failed).toHaveCount(0);
    }).toPass({ timeout: 15_000 });
  }

  test('очередь цеха предлагает повторить и восстанавливается', async ({ page }) => {
    const restore = await breakOrders(page);
    await page.goto('/queue?studio=0');
    // Оболочка появляется раньше данных; ждём её, чтобы не мерить холодный старт
    // Vite вместе с ответом сервера — под параллельными воркерами это разные величины
    await expect(page.getByRole('complementary')).toBeVisible();

    const failed = page.getByText('Не удалось загрузить задания цеха');
    await expect(failed).toBeVisible();
    // Самое важное: это НЕ читается как «заданий нет»
    await expect(page.getByText('Выберите свой цех выше')).toHaveCount(0);

    restore();
    await retryUntilLoaded(page, failed);
    // Вкладки цехов рисуются только по загруженным departments — значит данные пришли
    await expect(page.getByRole('tablist', { name: 'Выбор цеха' })).toBeVisible();
  });

  test('список заказов предлагает повторить вместо пустого экрана', async ({ page }) => {
    const restore = await breakOrders(page);
    await page.goto('/orders?studio=0');
    await expect(page.getByRole('complementary')).toBeVisible();

    const failed = page.getByText('Не удалось загрузить заказы');
    await expect(failed).toBeVisible();

    restore();
    await retryUntilLoaded(page, failed);
    await expect(page.getByText('54900').first()).toBeVisible();
  });
});

test.describe('Загрузка цехов (/load)', () => {
  test('сетка «цех × день»: неделя, хвостовые колонки и переключение недель', async ({ page }) => {
    await page.goto('/load?studio=0');
    await expect(page.getByRole('heading', { name: 'Загрузка цехов' })).toBeVisible();

    // Семь дней недели + две хвостовые колонки: без них экран не отвечает
    // на «что просрочено» и «что вообще без плана»
    const head = page.locator('thead tr').first();
    await expect(head.locator('th')).toHaveCount(10);
    await expect(head.getByText('Просрочено')).toBeVisible();
    await expect(head.getByText('Без плана')).toBeVisible();

    // Фикстуры без плановых дат: вся работа обязана быть видна в «Без плана»,
    // иначе экран молча теряет задания
    await expect(page.getByRole('row', { name: /Закрой/ }).getByText(/шт/)).toBeVisible();

    const period = page.getByText(/·\s*текущая/);
    await expect(period).toBeVisible();
    await page.getByRole('button', { name: 'Неделя вперёд' }).click();
    await expect(period).toBeHidden();
    await page.getByRole('button', { name: 'Сегодня' }).click();
    await expect(period).toBeVisible();
  });

  /**
   * «Планов нет ни у чего» экран обязан называть вслух.
   *
   * Строки цехов есть и без единой плановой даты — их держат этапы без плана, —
   * поэтому пустое состояние не показывается вовсе: человек видит семь колонок
   * прочерков и читает это как «загрузка нулевая». На проде 22.08 было ровно
   * так: 43 открытых этапа, плановой даты нет ни у одного.
   */
  test('без единой плановой даты экран говорит, что загрузка не считается', async ({ page }) => {
    await page.goto('/load?studio=0');
    await expect(page.getByRole('heading', { name: 'Загрузка цехов' })).toBeVisible();
    await expect(
      page.getByText(/Загрузка не рассчитывается: плановых дат нет ни у одного открытого этапа/),
    ).toBeVisible();
  });

  /**
   * Полоса обязана говорить, КУДА идти. Срок ставится в карточке заказа,
   * и без списка человек остаётся с задачей «найди сам среди пятнадцати».
   */
  test('полоса ведёт в заказы, у которых нет срока', async ({ page }) => {
    await page.goto('/load?studio=0');
    await expect(page.getByText(/Загрузка не рассчитывается/)).toBeVisible();
    const link = page.getByRole('link', { name: /без срока/ }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/orders\/[\w-]+/);
  });

  test('появилась хоть одна плановая дата — полосы больше нет', async ({ page }) => {
    // Иначе предупреждение висело бы всегда и перестало что-либо значить
    await installSupabaseMock(page, { orders: [PLANNED_ORDER] });
    await page.goto('/load?studio=0');
    await expect(page.getByRole('heading', { name: 'Загрузка цехов' })).toBeVisible();
    await expect(page.getByText(/Загрузка не рассчитывается/)).toHaveCount(0);
  });
});

/**
 * Заказ, у которого закрой ждёт ЗАКУПКУ. Базовые четыре фикстуры такого
 * не несут, а дописывать в них нельзя: они держат visual-эталоны и счётчики
 * очередей.
 */
const SUPPLY_WAIT_ORDER = {
  id: 'ord-supply', bitrix_id: '90888', title: 'Заказ ждёт закупку',
  customer: 'ООО «Ромашка»', manager: 'Анна',
  launch_date: '2026-07-16', due_date: '2026-08-30', buffer_days: 1,
  priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  attachments: [], materials: [], warehouse_tasks: [],
  items: [{
    id: 'ord-supply-i1', order_id: 'ord-supply', product_type: 'Футболка', variant: null,
    qty: 50, production_type: 'sewing', branding_methods: [], branding_on: 'cut',
    notes: null, size_grid: null, sort_order: 0,
    subcontract_kind: null, material_source: 'pinhead',
    fit: null, main_fabric: null, trim_material: null,
    cutting_note: null, sewing_note: null, labels_note: null,
    packaging: 'inherit', packaging_size: null, sticker_place: null,
    marking_place: null, packaging_note: null,
    created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
    prints: [], labels: [],
    // Закупка ещё идёт, закрой зависит от неё — «Закупка: ещё не завершено»
    stages: buildStages('ord-supply-i1', [
      { code: 'supply', status: 'in_progress' },
      { code: 'cutting', status: 'waiting', deps: [0] },
    ]),
  }],
};

/** Заказ с плановыми датами этапов — базовые фикстуры их не несут */
const PLANNED_ORDER = {
  id: 'ord-planned', bitrix_id: '90777', title: 'Заказ с планом',
  customer: 'ООО «Ромашка»', manager: 'Анна',
  launch_date: '2026-07-16', due_date: '2026-07-30', buffer_days: 1,
  priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  attachments: [], materials: [], warehouse_tasks: [],
  items: [{
    id: 'ord-planned-i1', order_id: 'ord-planned', product_type: 'Футболка', variant: null,
    qty: 50, production_type: 'sewing', branding_methods: [], branding_on: 'cut',
    notes: null, size_grid: null, sort_order: 0,
    subcontract_kind: null, material_source: 'pinhead',
    fit: null, main_fabric: null, trim_material: null,
    cutting_note: null, sewing_note: null, labels_note: null,
    packaging: 'inherit', packaging_size: null, sticker_place: null,
    marking_place: null, packaging_note: null,
    created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
    prints: [], labels: [],
    stages: buildStages('ord-planned-i1', [{ code: 'cutting', status: 'waiting' }])
      .map((st) => ({ ...st, planned_start: '2026-07-21', planned_end: '2026-07-22' })),
  }],
};
