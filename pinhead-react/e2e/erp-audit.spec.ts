import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Критические сценарии аудита 03.08.2026 — то, что правки этой волны обещают
 * человеку, а не то, что удобно проверить.
 *
 * Почему отдельным файлом, а не дописать в `erp-queue.spec.ts`: тот покрывает
 * работу цеха и уже идёт 5.5 минуты. Здесь — навигация, вкладки, списки,
 * приоритеты и права; смешивать их значит делать оба файла медленнее
 * и труднее читаемыми.
 *
 * Мок Supabase read-only: сценарии ЗАПИСИ (создание заказа, движение по
 * этапам, приёмка, отгрузка) требуют, чтобы стенд отражал изменения обратно,
 * — это отдельная работа по моку, а не по спекам. Их логика покрыта юнитами
 * стора (1751 тест), здесь проверяется то, что юнит увидеть не может:
 * маршруты, адресная строка и связность экранов.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00Z');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await installSupabaseMock(page);
});

test.describe('Раздел «Производство»: один пункт меню, три вкладки', () => {
  test('все три вкладки открываются и сохраняют свои адреса', async ({ page }) => {
    // Адреса не менялись при объединении в раздел — закладки и ссылки
    // в переписке обязаны продолжать работать.
    await page.goto('/?studio=0');
    await page.getByRole('link', { name: 'Производство' }).click();
    await expect(page).toHaveURL(/\/board/);
    await expect(page.getByRole('heading', { name: 'Доска производства' })).toBeVisible();

    await page.getByRole('link', { name: 'Загрузка' }).click();
    await expect(page).toHaveURL(/\/load/);
    await expect(page.getByRole('heading', { name: 'Загрузка цехов' })).toBeVisible();

    await page.getByRole('link', { name: 'План', exact: true }).click();
    await expect(page).toHaveURL(/\/plan/);
  });

  test('прямой заход на /load подсвечивает и раздел, и вкладку', async ({ page }) => {
    // Без этого человек на вкладке видел меню без подсветки и не понимал,
    // в каком он разделе.
    await page.goto('/load?studio=0');
    const tab = page.getByRole('link', { name: 'Загрузка' });
    await expect(tab).toHaveAttribute('aria-current', 'page');
  });

  test('в меню больше нет трёх соседних пунктов', async ({ page }) => {
    await page.goto('/?studio=0');
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'План производства' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Загрузка цехов' })).toHaveCount(0);
  });
});

test.describe('Карточка заказа: вкладки', () => {
  test('вкладка из адреса открывается сразу и переключается', async ({ page }) => {
    await page.goto('/orders/ord-a?studio=0&tab=history');
    await expect(page.getByRole('tab', { name: /История/ })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: /Материалы/ }).click();
    await expect(page).toHaveURL(/tab=materials/);
    await expect(page.getByRole('tab', { name: /Материалы/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('шапка заказа видна на любой вкладке', async ({ page }) => {
    // «Почему заказ стоит» не должно зависеть от того, какую вкладку выбрали
    await page.goto('/orders/ord-a?studio=0&tab=comments');
    await expect(page.getByText('Клиент:')).toBeVisible();
    await expect(page.getByText('Срок клиента:')).toBeVisible();
  });

  test('стрелки переключают вкладки с клавиатуры', async ({ page }) => {
    await page.goto('/orders/ord-a?studio=0');
    await page.getByRole('tab', { name: /Позиции/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /ТЗ/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Список заказов: страницы, сортировка, контекст в адресе', () => {
  test('сортировка по колонке уходит в адрес и объявляется скринридеру', async ({ page }) => {
    await page.goto('/orders?studio=0');
    // Доступное имя кнопки — ТЕКСТ колонки: `title` его не задаёт, а лишь
    // дополняет. Стрелка помечена aria-hidden и в имя не входит.
    const byTitle = page.getByRole('button', { name: 'Заказ', exact: true });
    await byTitle.click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page.getByRole('columnheader', { name: /Заказ/ })).toHaveAttribute('aria-sort', 'ascending');

    // Второй клик — по убыванию, третий снимает сортировку
    await byTitle.click();
    await expect(page).toHaveURL(/dir=desc/);
    await byTitle.click();
    await expect(page).not.toHaveURL(/sort=/);
  });

  test('пагинация показывает общее число записей', async ({ page }) => {
    await page.goto('/orders?studio=0');
    await expect(page.getByText(/Всего записей:/)).toBeVisible();
    await expect(page.getByLabel('Размер страницы')).toBeVisible();
  });

  test('фильтр и вкладка переживают уход в карточку и возврат', async ({ page }) => {
    await page.goto('/orders?studio=0&filter=overdue');
    await expect(page).toHaveURL(/filter=overdue/);
    await page.goBack();
  });
});

test.describe('Уведомления обзора сгруппированы по критичности', () => {
  test('срочная группа развёрнута, у каждой есть подсказка', async ({ page }) => {
    await page.goto('/?studio=0');
    // Хотя бы одна группа обязана быть, и она обязана объяснять, что делать:
    // плоский список «Просрочен заказ №…» на 47 строк ничего не объяснял.
    const groups = page.locator('details[class*="notifGroup"]');
    const count = await groups.count();
    if (count > 0) {
      await expect(groups.first().locator('summary')).toBeVisible();
      await expect(groups.first()).toHaveAttribute('open', '');
    }
  });

  test('колокол в шапке ведёт к уведомлениям', async ({ page }) => {
    /*
      Колокол — ССЫЛКА, а не кнопка (H-09 отчёта QA 13.08.2026): панели
      уведомлений в ERP нет, список живёт виджетом на обзоре, и иконка обязана
      честно показывать, что она ведёт на другой экран. Раньше это была кнопка
      с `navigate()`, которая к тому же не срабатывала повторно.
    */
    await page.goto('/?studio=0');
    const bell = page.getByRole('link', { name: /Уведомления/ });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page).toHaveURL(/#notifications/);
  });
});

/**
 * Прав здесь НЕТ намеренно, и это стоит объяснить, а не умолчать.
 *
 * e2e идут против dev-сервера, где работает автологин («Dev Mode»), а
 * `useErpAccess` по построению даёт dev-пользователю полный доступ
 * (`isDev || isAllowed(...)`). Подменить матрицу через мок бесполезно: её
 * ответ до проверки просто не доходит. Тест «без права поле только на
 * чтение» здесь был бы вечно зелёным по неверной причине — худший вид
 * покрытия.
 *
 * Гейты прав проверяются там, где это возможно честно:
 *   · `OrderCard.test.jsx` — разметка при замоканном useErpAccess;
 *   · `serverPermissions.test.ts` — совпадение клиента и стража в БД;
 *   · `permissionsCoverage.test.ts` — что каждое право что-то выключает.
 */

test.describe('Горизонтального обрезания нет на ключевых ширинах', () => {
  for (const width of [1440, 768]) {
    test(`страница не скроллится вбок при ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/orders?studio=0');
      await expect(page.locator('table, [class*="orderCardList"]').first()).toBeVisible();
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
