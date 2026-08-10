import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Недельный производственный план (правка менеджера 2026-08-03).
 *
 * Главное, что проверяется, — обещание интерфейса: план ручной, система сама
 * ничего не переносит. Недовыполненная задача остаётся на своей дате и попадает
 * в «Требуют решения», а не переезжает на завтра.
 */

// Понедельник недели фикстур: слоты стоят на 20 и 21 июля
const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await installSupabaseMock(page);
});

test.describe('План производства', () => {
  test('открывается вкладкой раздела «Производство», сводкой по цехам', async ({ page }) => {
    // Три соседних пункта меню («Производство», «План производства»,
    // «Загрузка цехов») сведены в один раздел с вкладками (аудит 03.08.2026).
    // Адрес /plan сохранён — он и стал адресом вкладки.
    await page.goto('/?studio=0');
    await page.getByRole('link', { name: 'Производство' }).click();
    await expect(page).toHaveURL(/\/board/);
    await page.getByRole('link', { name: 'План' }).click();

    await expect(page).toHaveURL(/\/plan/);
    await expect(page.getByRole('heading', { name: 'План производства' })).toBeVisible();
    // Вкладка «Все цеха» — краткий управленческий экран (требование 5.12)
    await expect(page.getByRole('tab', { name: 'Все цеха' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('columnheader', { name: 'План на день' })).toBeVisible();
  });

  test('вкладка цеха показывает дни недели, план, факт и остаток', async ({ page }) => {
    await page.goto('/plan?dept=cutting&studio=0');

    await expect(page.getByText('Понедельник')).toBeVisible();
    await expect(page.getByText('Пятница')).toBeVisible();

    // Задача понедельника: план 30, сделано 20 — остаток 30−20
    const card = page.locator('[class*="planCard"]').filter({ hasText: '54900' }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('30');
    await expect(card).toContainText('20');
    await expect(card).toContainText('10');
    // Цвет дублируется текстом — состояние читается и без цвета
    await expect(card).toContainText('Выполнено частично');
  });

  test('недовыполнение остаётся на своей дате и попадает в отклонения', async ({ page }) => {
    // Пятница той же недели: понедельник уже прошёл, план не закрыт
    await page.clock.setFixedTime(new Date('2026-07-24T09:00:00'));
    await page.goto('/plan?dept=cutting&week=2026-07-20&studio=0');

    const deviations = page.getByRole('heading', { name: /Требуют решения/ });
    await expect(deviations).toBeVisible();

    // Задача НЕ уехала на сегодня — она осталась в понедельнике
    const monday = page.locator('[class*="planDay"]').first();
    await expect(monday).toContainText('54900');
  });

  test('неделя переключается и живёт в адресе', async ({ page }) => {
    await page.goto('/plan?dept=cutting&studio=0');
    await page.getByRole('button', { name: /^Неделя$/ }).last().click();
    await expect(page).toHaveURL(/week=2026-07-27/);
    await page.getByRole('button', { name: 'Текущая неделя' }).click();
    await expect(page).not.toHaveURL(/week=/);
  });

  test('кабинет цеха получил вкладку «План» рядом с очередью', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    // exact: рядом появилась кнопка «Поставить в план» у строки задания
    // (правки 10.08), и подстрочное совпадение по слову «план» ловит обе
    await page.getByRole('button', { name: 'План', exact: true }).click();
    // План цеха только читается: постановки задач здесь нет
    await expect(page.getByText(/сегодня план/)).toBeVisible();
    await expect(page.getByRole('button', { name: /В план на этот день/ })).toHaveCount(0);
  });

  /**
   * Очередь «Не запланировано» (правки заказчика 10.08).
   *
   * Главное здесь — ГОРИЗОНТ, а не видимая неделя: задача на 21 июля уже стоит
   * в плане, поэтому в очереди её быть не должно, хотя открыт август.
   */
  test('очередь «Не запланировано» учитывает весь горизонт, а не неделю', async ({ page }) => {
    await page.goto('/plan?dept=cutting&studio=0');
    // Закрой: единственное готовое к запуску задание (Фартук) стоит в плане на 21.07
    await expect(page.getByRole('heading', { name: 'Не запланировано (0)' })).toBeVisible();
    await expect(page.getByText('Вся работа, готовая к запуску, разложена по дням.')).toBeVisible();
  });

  test('снятая с плана задача возвращается в очередь «Не запланировано»', async ({ page }) => {
    // Август: июльские задачи в прошлом, «что стоит в плане с сегодня» — пусто
    await page.clock.setFixedTime(new Date('2026-08-10T09:00:00'));
    await page.goto('/plan?dept=cutting&studio=0');

    const queue = page.getByRole('region', { name: 'Не запланировано' });
    await expect(queue.getByRole('heading', { name: /Не запланировано \(1\)/ })).toBeVisible();
    await expect(queue).toContainText('Готово к запуску, но ни на один день не поставлено.');
    // Постановка доступна и без перетаскивания — на планшете цеха его нет вовсе
    await queue.getByRole('button', { name: 'В план' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Поставить задачу в план' })).toBeVisible();
    // День спрашивается: ячейку не выбирали
    await expect(page.getByLabel('День, на который ставится задача')).toBeVisible();
  });

  test('очередь цеха ставит задание в план, не уходя со списка', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await page.getByRole('button', { name: 'Поставить в план' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Поставить задачу в план' });
    await expect(dialog).toBeVisible();
    // Задание уже выбрано — список пятидесяти строк не показывается
    await expect(dialog).toContainText('54900');
    await expect(dialog.getByPlaceholder('заказ, клиент, изделие')).toHaveCount(0);
  });
});

/**
 * Регресс со скриншота заказчика (10.08.2026): доска показывала неделю
 * «08.08 — 12.08» и подписывала колонки «Понедельник 08.08 … Среда 10.08»,
 * хотя 10 августа — понедельник.
 *
 * Прогон идёт В ПОЯСЕ ЗАКАЗЧИКА (UTC+3). В UTC ошибка не воспроизводится
 * ВООБЩЕ — сдвиг равен нулю, — поэтому и на прод она приехала при зелёном CI.
 * Проверяем через браузер, а не только утилитой: подпись дня раньше бралась
 * по номеру колонки и с датой не спорила.
 */
test.describe('дата и день недели в поясе UTC+3', () => {
  test.use({ timezoneId: 'Europe/Moscow' });

  test('текущая неделя начинается с понедельника 10.08, а не с субботы', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-10T09:00:00+03:00'));
    await page.goto('/plan?dept=cutting&studio=0');

    // Заголовок периода: неделя 10.08 — 14.08, а не 08.08 — 12.08
    await expect(page.getByText('10.08.2026 — 14.08.2026').first()).toBeVisible();

    const first = page.locator('[class*="planDay"]').first();
    await expect(first).toContainText('Понедельник');
    await expect(first).toContainText('10.08.2026');
  });

  test('подпись дня следует за датой, а не за номером колонки', async ({ page }) => {
    // Ссылка с чужой неделей: подпись обязана называть настоящий день
    await page.clock.setFixedTime(new Date('2026-08-10T09:00:00+03:00'));
    await page.goto('/plan?dept=cutting&week=2026-08-17&studio=0');

    const first = page.locator('[class*="planDay"]').first();
    await expect(first).toContainText('Понедельник');
    await expect(first).toContainText('17.08.2026');
  });
});

/**
 * Пояс ПРОИЗВОДСТВА — московский, независимо от того, откуда открыли (решение
 * заказчика). Браузер здесь стоит в Лос-Анджелесе, и момент выбран так, что
 * у него на календаре ещё 9 августа, а на фабрике уже 10-е: доска обязана
 * показать неделю ЦЕХА. Прежняя реализация читала местные поля браузера
 * и показала бы менеджеру его собственную неделю.
 */
test.describe('день фабрики виден из чужого пояса', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('неделя считается по Москве, а не по браузеру', async ({ page }) => {
    // 10.08 09:00 МСК = 06:00 UTC = 09.08 23:00 в Лос-Анджелесе
    await page.clock.setFixedTime(new Date('2026-08-10T09:00:00+03:00'));
    await page.goto('/plan?dept=cutting&studio=0');

    await expect(page.getByText('10.08.2026 — 14.08.2026').first()).toBeVisible();

    const first = page.locator('[class*="planDay"]').first();
    await expect(first).toContainText('Понедельник');
    await expect(first).toContainText('10.08.2026');
  });
});
