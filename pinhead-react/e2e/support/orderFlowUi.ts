import { expect, type Page } from '@playwright/test';
import { installSupabaseMock, type MockCall, type MockExtras } from './mockSupabase';
import { MS, NOW, loginAs, newOrderGetsUuid, rpcCalls, settled, tzFixture } from './orderFlowFx';

/**
 * Шаги сквозного потока заказа по экранам (`order-flow.spec.ts`, веха 6+7,
 * задача 7): продавец собирает заказ и отправляет его в работу, МС открывает
 * «К запуску» из меню. Сеть — мок J (`mock/orderV4Rpc.ts`).
 */

export const CUSTOMER = 'ООО «Ромашка»';
export const TITLE = 'Футболки для фестиваля «Ёлка»';

/** Изделие на панелях визарда: футболка Free Fit, кулирка, чёрный, M 20 + L 10 */
export async function addTee(page: Page) {
  await page.getByRole('button', { name: 'Добавить изделие' }).click();
  await page.getByRole('button', { name: /^Футболка Free Fit free/ }).click();
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await page.getByRole('button', { name: /^Кулирка 100% хб · 180 г\/м²/ }).first().click();
  await page.getByRole('button', { name: 'Чёрный (40-01)', exact: true }).click();
  for (const [size, n] of [['M', 20], ['L', 10]] as const) {
    const input = page.getByRole('spinbutton', { name: `Размер ${size}`, exact: true });
    await input.fill(String(n));
    await input.blur();
  }
  await settled(page);
}

/** Файл фикстуры в «Загрузить логотип»; тип — по расширению имени, как у браузера */
export async function uploadLogo(page: Page, file: string) {
  const mimeType = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  await page.getByRole('region', { name: 'Логотипы' }).locator('input[type="file"]')
    .setInputFiles({ name: file, mimeType, buffer: tzFixture(file) });
}

/** Логотип на вкладке «Дизайн» (по умолчанию PNG) — ложится в зону «Грудь (перед)» */
export async function placeLogo(page: Page, file = 'logo.png') {
  await page.getByRole('tab', { name: /^Дизайн/ }).click();
  await expect(page.getByRole('application', { name: /^Холст/ })).toHaveAttribute('data-ready', 'true');
  await uploadLogo(page, file);
  const layers = page.getByRole('list', { name: 'Нанесения на виде' }).getByRole('listitem');
  await expect(layers).toHaveCount(1);
  await expect(layers.first()).toContainText('Грудь (перед)');
  await settled(page);
}

/** Новый заказ с изделием, открыта вкладка «Дизайн» с готовым холстом */
export async function buildOrderUntilDesign(page: Page, extra: MockExtras) {
  await page.clock.setFixedTime(new Date(NOW));
  await installSupabaseMock(page, extra);
  await newOrderGetsUuid(page);
  await page.goto('/sales?studio=1');
  await page.getByRole('main').getByRole('button', { name: 'Новый заказ' }).first().click();
  await addTee(page);
  await page.getByRole('tab', { name: /^Дизайн/ }).click();
  await expect(page.getByRole('application', { name: /^Холст/ })).toHaveAttribute('data-ready', 'true');
}

/** Продавец собирает заказ до «ТЗ и цена»; `logo` — файл фикстуры логотипа */
export async function buildOrder(page: Page, extra: MockExtras, logo = 'logo.png') {
  await buildOrderUntilDesign(page, extra);
  await placeLogo(page, logo);
  await page.getByRole('tab', { name: /^Клиент/ }).click();
  await page.getByLabel('Клиент', { exact: true }).fill(CUSTOMER);
  await page.getByLabel('Название заказа').fill(TITLE);
  await page.getByLabel('Срок (дата в КП)').fill('2026-11-20');
  await settled(page);
  await page.getByRole('tab', { name: /^ТЗ и цена/ }).click();
  await expect(page).toHaveURL(/tab=summary/);
}

/** «Отметить предоплату» (dev-админ — руководство продаж, подтверждения нет) */
export async function markPrepaid(page: Page) {
  await page.getByRole('button', { name: 'Отметить предоплату' }).click();
  await expect(page.getByText(/^Предоплата получена/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Оплата', level: 2 })).toBeFocused();
}

/** Кнопка раздела «Отправить в работу» (кнопка шапки только ведёт сюда) */
export const sendButton = (page: Page) => page.locator('#send').getByRole('button', { name: 'Отправить в работу', exact: true });

/** «Отправить в работу» и итог «Отправлен в работу …» */
export async function sendToWork(page: Page) {
  await expect(page.getByText('Чек-лист пройден — заказ готов к отправке')).toBeVisible();
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: /^Отправлен в работу \d\d\.\d\d — правка закрыта$/ })).toBeFocused();
}

/** Путь PDF ТЗ позиции из последнего сохранения */
export function tzPathOf(calls: MockCall[]): string {
  const save = rpcCalls(calls, 'order_v4_save_full').at(-1)!.body as { p_order: { items: { tz_pdf_path: string }[] } };
  return save.p_order.items[0].tz_pdf_path;
}

/** Расчёт `layoutTz` той же модели, что у отправки (метрики шрифта PDF) — число страниц */
export async function expectedPages(page: Page, flats: unknown): Promise<number> {
  return page.evaluate(async (flatsCatalog) => {
    const { useSalesStore } = await import('/src/orderstudio/store/useSalesStore.ts');
    const { useStore } = await import('/src/store/useStore.ts');
    const { tzCatalogsOf } = await import('/src/orderstudio/tz/tzCatalogs.ts');
    const { tzGroups } = await import('/src/orderstudio/tz/model/tzGroups.ts');
    const { tzDocument } = await import('/src/orderstudio/tz/model/tzDocument.ts');
    const { layoutTz } = await import('/src/orderstudio/tz/model/layoutTz.ts');
    const { loadPdfFonts, newPdf } = await import('/src/orderstudio/design/export/pdfCore.ts');
    const { fontMeasure } = await import('/src/orderstudio/tz/pdf/drawBoxes.ts');
    const { APP_ORIGIN } = await import('/src/orderstudio/tz/appOrigin.ts');
    const order = useSalesStore.getState().current!;
    const catalogs = tzCatalogsOf(useStore.getState() as never, flatsCatalog as never);
    const pdf = await newPdf(await loadPdfFonts(), 'a4', 'portrait');
    const [group] = tzGroups(order);
    const doc = tzDocument(order, group, catalogs, { issuedOn: '2026-10-20', appOrigin: APP_ORIGIN });
    return layoutTz(doc, fontMeasure(pdf)).pages;
  }, flats);
}


/** Заказ продавца в `ready_to_launch`: сборка, предоплата, отправка */
export async function sentOrder(page: Page, extra: MockExtras, logo = 'logo.png') {
  await buildOrder(page, extra, logo);
  await markPrepaid(page);
  await sendToWork(page);
}

/** Вход МС (профиль приложения и вызывающий мока) → «К запуску» в меню → строка → экран запуска */
export async function openLaunchAsMs(page: Page, extra: MockExtras, v4: MockExtras['v4'] = { caller: MS }) {
  extra.v4 = v4;
  await loginAs(page, { ...MS, ...(v4?.caller ?? {}) });
  await page.getByRole('link', { name: 'К запуску' }).click();
  await expect(page).toHaveURL(/status=ready_to_launch/);
  await page.getByRole('main').getByRole('button', { name: 'PH-9001', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('К запуску: PH-9001');
}

export const launchButton = (page: Page) => page.getByRole('button', { name: 'Запустить в производство' });
