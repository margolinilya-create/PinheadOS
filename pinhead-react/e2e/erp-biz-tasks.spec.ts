import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, resetChatMock } from './support/mockSupabase';

/**
 * БИЗНЕС-ЗАДАЧИ В БРАУЗЕРЕ (правки 19.10, п. 7, Task 10).
 *
 * Юнит-тесты проверяют части (форма, карточка, диалог, стор), пробы — писателей
 * на сервере. Здесь — СВЯЗКА: задача создаётся из карточки заказа, открывается
 * по ссылке списка, проходит «в работе → на проверке → возврат → принята»,
 * а в её диалоге уходит сообщение с упоминанием. Мок держит задачи СОСТОЯНИЕМ
 * (`support/mock/bizTasksRpc.ts`: версия `updated_at`, таблица переходов
 * `BIZ_TASK_TRANSITIONS`, роль вызывающего) — фикстура «только для чтения»
 * молчала бы ровно на переходах.
 *
 * Вызывающий — dev-админ (`id = dev`): он и постановщик, и ответственный
 * («Проверка постановщиком» включена), поэтому весь цикл проходит один человек.
 */

const ORDER = 'ord-a';


/** Сотрудники ERP (непустая `role`): ответственным и наблюдателем форма предлагает только их */
const DIRECTORY = [
  { user_id: 'dev', name: 'Dev Mode', email: null, role: 'manager', department_id: null },
  { user_id: 'u-maria', name: 'Мария', email: null, role: 'purchaser', department_id: null },
];

test.beforeEach(async ({ page }) => {
  resetChatMock();
  await installSupabaseMock(page, { chatDirectory: DIRECTORY });
  await page.clock.setFixedTime(new Date('2026-07-20T09:00:00'));
});

/** Выбрать человека в поле-комбобоксе формы: имя → Enter */
async function pickPerson(page: Page, label: string, name: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.fill(name);
  await expect(page.getByRole('listbox', { name: label }).getByRole('option', { name: new RegExp(name) })).toBeVisible();
  await box.press('Enter');
}

/** Создать задачу во вкладке «Задачи» заказа и открыть её карточку */
async function createTaskFromOrder(page: Page) {
  await page.goto(`/orders/${ORDER}?studio=0&tab=tasks`);
  await page.getByRole('button', { name: 'Создать задачу' }).click();
  const form = page.getByRole('form', { name: 'Новая задача' });
  await form.getByRole('textbox', { name: /Название/ }).fill('Доставить заказ клиенту');
  await form.getByRole('radio', { name: 'Доставка' }).check();
  await pickPerson(page, 'Ответственный', 'Dev Mode');
  await form.getByLabel(/Срок, МСК/).fill('2026-07-22T18:00');
  await form.getByRole('button', { name: /Дополнительно/ }).click();
  await pickPerson(page, 'Наблюдатели', 'Мария');
  await form.getByRole('checkbox', { name: 'Проверка постановщиком' }).check();
  await form.getByRole('button', { name: 'Создать задачу' }).click();

  const link = page.getByRole('link', { name: /Доставить заказ клиенту/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/biz-tasks\/bt-new-\d+/);
  await expect(page.getByRole('heading', { name: 'Доставить заказ клиенту' })).toBeVisible();
}

/** Переход с обязательным текстом: кнопка → поле диалога → подтверждение */
async function transitionWithText(page: Page, button: string, field: string, text: string) {
  await page.getByRole('button', { name: button }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: new RegExp(field) }).fill(text);
  await dialog.getByRole('button', { name: button }).click();
  await expect(dialog).toBeHidden();
}

test.describe('Бизнес-задачи', () => {
  test('создание из заказа → в работу → сообщение с @ → проверка → возврат → принята', async ({ page, viewport }) => {
    // На ≤ 760 px диалог и действия — на разных вкладках карточки; раскладку проверяет тест ниже
    test.skip((viewport?.width ?? 1280) <= 760, 'цикл — на десктопной раскладке карточки');
    await createTaskFromOrder(page);

    await page.getByRole('button', { name: 'Взять в работу' }).click();
    await expect(page.getByText('В работе').first()).toBeVisible();

    // Диалог задачи: упоминание наблюдателя из подсказки участников
    const field = page.getByRole('textbox', { name: 'Новое сообщение' });
    // Упоминание — последним: подстановка ставит курсор следующим кадром, печать
    // после неё гонялась бы с ним (буква уезжала в конец строки)
    await field.fill('забираю в четверг, @Мар');
    await expect(page.getByRole('listbox').getByRole('option', { name: /Мария/ })).toBeVisible();
    await field.press('Enter');
    await expect(field).toHaveValue(/^забираю в четверг, @Мария\s$/);
    await page.getByRole('button', { name: /Отправить/ }).click();
    await expect(page.getByRole('article').filter({ hasText: 'забираю в четверг' })).toBeVisible();

    await transitionWithText(page, 'Сдать на проверку', 'Результат', 'Доставлено, накладная у водителя');
    await expect(page.getByText('На проверке').first()).toBeVisible();

    await transitionWithText(page, 'Вернуть в работу', 'Что исправить', 'Приложите фото накладной');
    await expect(page.getByText('В работе').first()).toBeVisible();

    await transitionWithText(page, 'Сдать на проверку', 'Результат', 'Фото накладной в обсуждении');
    await page.getByRole('button', { name: 'Принять' }).click();
    await expect(page.getByText('Завершена').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Принять' })).toHaveCount(0);
  });

  test('375 px: карточка задачи — вкладки «Задача / Обсуждение / История / Файлы»', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await createTaskFromOrder(page);

    const tabs = page.getByRole('tablist', { name: 'Разделы задачи' });
    await expect(tabs).toBeVisible();
    for (const name of ['Задача', 'Обсуждение', 'История', 'Файлы']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }
    await tabs.getByRole('tab', { name: 'Обсуждение' }).click();
    await expect(page).toHaveURL(/pane=chat/);
    await expect(page.getByRole('textbox', { name: 'Новое сообщение' })).toBeVisible();

    // Без горизонтальной прокрутки страницы
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
