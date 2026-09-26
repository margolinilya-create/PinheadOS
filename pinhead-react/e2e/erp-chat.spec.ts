import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, resetChatMock } from './support/mockSupabase';

/**
 * ЧАТ СДЕЛКИ В БРАУЗЕРЕ (правка 20.09, п. 4, и вторая очередь).
 *
 * Юнит-тесты проверяют части (лента, реакции, поиск, панель), живая база —
 * серверные гейты. Не проверенной оставалась СВЯЗКА: человек открывает чат,
 * пишет, ставит реакцию, ищет, уходит на другой экран. Именно здесь ломается
 * то, чего не видит ни один из двух других слоёв: окно смонтировано
 * в оболочке раздела, а данные приходят пятью разными RPC.
 *
 * Мок Supabase держит переписку СОСТОЯНИЕМ (см. `resetChatMock`): фикстура
 * «только для чтения» молчала бы ровно там, где отправка и реакция
 * и проверяются.
 */

const ORDER = 'ord-a';
/** Этап из фикстур — с него открывают чат задачи */
const STAGE = 'ord-b-i1-st2';

test.beforeEach(async ({ page }) => {
  resetChatMock();
  await installSupabaseMock(page);
  await page.clock.setFixedTime(new Date('2026-07-20T09:00:00'));
});

/** Открыть карточку заказа и перейти на вкладку «Чат» */
async function openChatTab(page: Page) {
  await page.goto(`/orders/${ORDER}?studio=0&tab=chat`);
  await expect(page.getByRole('tab', { name: /Чат/ })).toBeVisible();
}

test.describe('Чат сделки', () => {
  test('лента показывает переписку с именами из справочника', async ({ page }) => {
    await openChatTab(page);
    await expect(page.getByText('Ткань ромашка приехала, 47 кг')).toBeVisible();
    await expect(page.getByText('Принял, запускаем закрой')).toBeVisible();
    // Имя автора резолвится по справочнику, а не берётся из сообщения
    await expect(page.getByText('Мария').first()).toBeVisible();
  });

  test('отправка добавляет сообщение в ленту', async ({ page }) => {
    await openChatTab(page);
    const field = page.getByRole('textbox', { name: 'Новое сообщение' });
    await field.fill('Закрой начал');
    await page.getByRole('button', { name: /Отправить/ }).click();
    /**
     * Искать В ЛЕНТЕ, а не по всей странице: сообщение появляется в ней
     * раньше, чем композер очищает поле, и в этот кадр `getByText` находит
     * два элемента — реплику и textarea с тем же текстом (strict mode,
     * падение на мобильной раскладке в CI 26.09). Гонка настоящая, но
     * проверяемое свойство одно: реплика в ленте.
     */
    await expect(page.getByRole('article').filter({ hasText: 'Закрой начал' })).toBeVisible();
  });

  /**
   * ПРАВКИ, УДАЛЕНИЯ И «ПРОЧИТАЛИ N» ЗДЕСЬ НЕТ — И ЭТО НЕ ПРОПУСК.
   *
   * e2e идут против dev-сервера с автологином, где `useAuthStore.user.id`
   * равен строке `'dev'`, а `currentUserId()` намеренно возвращает на неё
   * `null` (см. `store/shared.ts`). Значит СВОИХ сообщений в этом окружении
   * не существует вовсе: `meId` пуст, и ни «Изменить», ни «Удалить», ни
   * счётчик прочтений не рисуются НИ У ОДНОЙ реплики.
   *
   * Спека на них была бы либо вечно красной, либо — после подгонки
   * локаторов — вечно зелёной по неверной причине: она проверяла бы
   * отсутствие кнопок там, где их нет у всех подряд. Это ровно тот случай,
   * который в `erp-audit.spec` уже описан для прав.
   *
   * Правка и удаление проверяются там, где это честно: разметка —
   * `components/chat/ChatMessage.test.jsx` (11 случаев, включая «у чужого
   * кнопок нет» и «у удалённого нет ни текста, ни файлов»), гейты —
   * `utils/chatServer.test.ts` и прогон от лица двух ролей на живой базе.
   */

  test('реакция ставится из набора и показывается счётчиком', async ({ page }) => {
    await openChatTab(page);
    const alien = page.getByRole('article').filter({ hasText: 'Ткань ромашка приехала' });

    await alien.getByRole('button', { name: 'Поставить реакцию' }).click();
    await page.getByRole('button', { name: '👍' }).click();

    await expect(alien.getByRole('button', { name: '👍, 1' })).toBeVisible();
    // Своя реакция отличима ДО нажатия — иначе её ставят второй раз, чтобы понять
    await expect(alien.getByRole('button', { name: '👍, 1' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * Поиск живёт в ОКНЕ чата (оно открывается поверх ERP), а не во вкладке
   * карточки: окно переживает переход между разделами, и переписку ищут
   * не только из карточки.
   */
  test('в окне чата ищется по переписке, находка ведёт к сообщению', async ({ page }) => {
    await page.goto(`/task/${STAGE}?studio=0`);
    await page.getByRole('button', { name: /Открыть чат/ }).click();

    const win = page.getByRole('dialog', { name: /Чат заказа/ });
    await expect(win).toBeVisible();

    await win.getByRole('button', { name: 'Поиск по переписке' }).click();
    await page.getByPlaceholder('Найти в переписке').fill('ромашка');
    await page.getByRole('button', { name: 'Найти' }).click();

    await expect(page.getByText(/Ткань ромашка приехала/).first()).toBeVisible();
  });

  test('окно чата переживает переход между разделами', async ({ page }) => {
    /**
     * ТОЛЬКО ШИРОКИЙ ЭКРАН — и это не поблажка, а свойство раздела: ниже
     * 760px окно чата раскрывается на весь экран (`inset: 0`), потому что
     * «окно поверх» на телефоне читается как отдельный экран. Переходить
     * между разделами, не закрыв его, там попросту некуда, и спека
     * проверяла бы несуществующий сценарий.
     */
    test.skip(
      (page.viewportSize()?.width ?? 0) < 760,
      'на узком экране окно занимает весь экран — переход возможен только после закрытия',
    );
    await page.goto(`/task/${STAGE}?studio=0`);
    await page.getByRole('button', { name: /Открыть чат/ }).click();
    await expect(page.getByRole('dialog', { name: /Чат заказа/ })).toBeVisible();

    /**
     * Уходим на другой экран — окно остаётся: оно смонтировано в оболочке.
     *
     * Переход именно ССЫЛКОЙ, а не `page.goto`: перезагрузка сбросила бы стор
     * вместе с окном, и тест «переживает переход» проверял бы перезагрузку.
     * На узком экране сайдбар — выезжающий оверлей, поэтому меню сначала
     * открывается кнопкой (иначе спека зелена только на десктопе).
     */
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('link', { name: 'Заказы' }).first().click();

    await expect(page.getByRole('dialog', { name: /Чат заказа/ })).toBeVisible();
  });
});
