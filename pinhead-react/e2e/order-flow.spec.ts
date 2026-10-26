import { test, expect, type Page } from '@playwright/test';
import { type MockCall } from './support/mockSupabase';
import { J_TEXTS, MOCK_ERP_ORDER, v4State } from './support/mock/orderV4Rpc';
import { erpUploadsByAttempt } from './support/mock/storageBuckets';
import { seedFlatsCatalog } from './support/flatsFixture';
import { axeSerious } from './support/orderCatalogFx';
import {
  FLAT, MS, MS2, NEW_ORDER, artworkObject, flowMock, pdfInfo, rpcCalls, settled, smallTargets, storageUploads,
} from './support/orderFlowFx';
import {
  CUSTOMER, TITLE, buildOrder, buildOrderUntilDesign, expectedPages, launchButton, markPrepaid, openLaunchAsMs, sendButton, sendToWork, sentOrder,
  tzPathOf, uploadLogo,
} from './support/orderFlowUi';

/**
 * Сквозной поток заказа до производства (веха 6+7, задача 7): настоящий
 * supabase-js, настоящие экраны, движок PDF ТЗ, стор ERP и копии файлов; мок
 * сети миграции J (`support/mock/orderV4Rpc.ts`) и бакетов с телом.
 *
 * Продавец (dev-админ): новый заказ → изделие → логотип на грудь → клиент
 * и срок → «Отметить предоплату» → предпросмотр ТЗ → «Отправить в работу».
 * PDF ТЗ берётся из мока Storage: текст с кириллицей, число страниц = раскладка,
 * ≤ 8 МБ, цен нет. МС: «К запуску» в меню → строка → «Запустить в производство»
 * → `erp_create_order` со связью, `tz.documents` по позиции и макетом нанесения.
 * Часы — 20.10.2026 10:00 по Москве (`timezoneId` — в конфиге Playwright).
 */

const PDF_MAX = 8 * 1024 * 1024;

test.describe.configure({ timeout: 180_000 });
test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'Поток с холстом — на десктопе; 375 и 760 px — axe ниже');

test('поток заказа: продавец собирает и отправляет, МС запускает — ТЗ и макет доезжают до ERP', async ({ page, context }) => {
  const calls: MockCall[] = [];
  const extra = flowMock(calls);
  await buildOrder(page, extra);
  await markPrepaid(page);
  expect(rpcCalls(calls, 'order_v4_set_payment').at(-1)!.body).toMatchObject({ p_id: NEW_ORDER, p_kind: 'prepaid' });

  // Предпросмотр: PDF в память, ссылкой в новой вкладке; в бакет ничего не уходит
  const before = storageUploads(calls, 'order-artworks').length;
  await page.getByRole('button', { name: 'Предпросмотр ТЗ' }).click();
  const open = page.getByRole('link', { name: /^Открыть ТЗ 1 из 1 \(PDF, / });
  await expect(open).toHaveAttribute('target', '_blank');
  const href = await open.getAttribute('href');
  const popup = context.waitForEvent('page');
  await open.click();
  // Вкладка открылась (просмотрщик PDF headless-Chromium адреса не отдаёт); байты — по той же ссылке
  await (await popup).close();
  expect(href).toMatch(/^blob:/);
  const head = await page.evaluate(async (u) => new Uint8Array(await (await fetch(u!)).arrayBuffer()).slice(0, 5).join(','), href);
  expect(String.fromCharCode(...head.split(',').map(Number))).toBe('%PDF-');
  expect(storageUploads(calls, 'order-artworks')).toHaveLength(before);

  await sendToWork(page);
  const send = rpcCalls(calls, 'order_v4_transition').at(-1)!.body;
  expect(send).toMatchObject({ p_id: NEW_ORDER, p_to: 'ready_to_launch' });
  expect(send).toHaveProperty('p_expected_updated_at');

  // PDF ТЗ — из мока Storage
  const tzPath = tzPathOf(calls);
  expect(tzPath).toMatch(new RegExp(`^orders/${NEW_ORDER}/tz/[0-9a-f-]{36}-PH-9001-g[0-9a-f]{8}-c[0-9a-f]{12}-`));
  const pdf = artworkObject(extra, tzPath);
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.length).toBeLessThanOrEqual(PDF_MAX);
  const { text, pages } = await pdfInfo(pdf);
  // Кириллица текстовым слоем. Клиента в ТЗ нет по формату образцов (цеху он не нужен):
  // вместо имени клиента — название заказа в заголовке и модель
  expect(text).toContain(`ТЕХНИЧЕСКОЕ ЗАДАНИЕ К ЗАКАЗУ № ${TITLE}`);
  expect(text).toContain('Футболка Free Fit');
  expect(text).toContain('Грудь');
  expect(text).not.toContain(CUSTOMER);
  expect(pages).toBe(await expectedPages(page, seedFlatsCatalog([FLAT])));
  // Цен в ТЗ нет: ни знака рубля, ни суммы позиции
  expect(text).not.toMatch(/₽|руб/i);
  for (const price of ['48 600', '48600', '1 620', '1620']) expect(text).not.toContain(price);

  // МС: «К запуску» в меню → строка → экран запуска
  await openLaunchAsMs(page, extra);
  await expect(page).toHaveURL(new RegExp(`/sales/${NEW_ORDER}/launch`));
  const launch = launchButton(page);
  await expect(launch).not.toHaveAttribute('aria-disabled', 'true');
  calls.splice(0);
  await launch.click();
  await expect(page.getByRole('heading', { name: 'Заказ запущен в производство' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Открыть PH-9001 в производстве' })).toBeVisible();
  expect(v4State(extra).orders.get(NEW_ORDER)?.status).toBe('production');

  type ErpBody = { order: Record<string, unknown>; items: unknown[]; tz: { documents: Record<string, unknown>[] }; attachments: Record<string, unknown>[] };
  const creates = v4State(extra).erpCreates as ErpBody[];
  expect(creates).toHaveLength(1);
  const body = creates[0];
  expect(body.order).toMatchObject({ tz_order_id: NEW_ORDER, tz_number: 'PH-9001', launch_date: '2026-10-21' });
  expect(body.tz.documents).toHaveLength(body.items.length);
  expect(body.tz.documents[0]).toMatchObject({ item_index: 0, mime_type: 'application/pdf' });
  // Копия макета и файл печати (Э4б: PNG в натуральную величину) — оба к нанесению 1
  expect(body.attachments).toHaveLength(2);
  // Мост шлёт `print_key`, стор ERP переводит его в номер нанесения — ни один макет не выброшен
  for (const a of body.attachments) {
    expect(a).toMatchObject({ kind: 'print', item_index: 0, print_index: 0 });
    expect(a).not.toHaveProperty('print_key');
    expect(String(a.file_path)).toMatch(/^att\/v4-[0-9a-f-]{36}\/print\/[0-9a-f-]{36}\.png$/);
  }
  expect(String(body.attachments[1].file_name)).toMatch(/^PH-9001_p1_front_[a-z_]+_127x64mm\.png$/);
  const printFile = extra.storageObjects?.[`erp-attachments/${String(body.attachments[1].file_path)}`];
  expect(printFile?.body.subarray(0, 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n');
  expect(printFile?.body.includes(Buffer.from('pHYs'))).toBe(true);
  expect(String(body.tz.documents[0].file_path)).not.toContain(NEW_ORDER);
  expect(v4State(extra).attachments).toHaveLength(2);
  expect(rpcCalls(calls, 'order_v4_transition').at(-1)!.body).toMatchObject({ p_to: 'production', p_erp_order_id: MOCK_ERP_ORDER });
  expect([...erpUploadsByAttempt(extra).values()]).toEqual([3]);
});

/** Ответ RPC ошибкой 500 ровно один раз, дальше — мок */
async function failOnce(page: import('@playwright/test').Page, fn: string, when: (body: Record<string, unknown>) => boolean = () => true) {
  let failed = false;
  await page.route(`**/rest/v1/rpc/${fn}`, async (route) => {
    if (!failed && when(route.request().postDataJSON() as Record<string, unknown>)) {
      failed = true;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '500', message: 'boom' }) });
      return;
    }
    await route.fallback();
  });
}

test('сбой посреди запуска: 500 на первый erp_create_order → «Не удалось создать заказ» → повтор → заказ ERP один, файлы второй попытки', async ({ page }) => {
  const calls: MockCall[] = [];
  const extra = flowMock(calls);
  await sentOrder(page, extra);
  await openLaunchAsMs(page, extra);
  await failOnce(page, 'erp_create_order');

  await launchButton(page).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Не удалось создать заказ в производстве' });
  await expect(alert).toBeFocused();
  await expect(alert).toHaveText('Запуск остановлен на шаге «создание заказа в производстве»: Не удалось создать заказ в производстве');
  const firstAttempt = [...erpUploadsByAttempt(extra).keys()];
  expect(firstAttempt).toHaveLength(1);

  await launchButton(page).click();
  await expect(page.getByRole('heading', { name: 'Заказ запущен в производство' })).toBeFocused();
  const creates = v4State(extra).erpCreates as { items: unknown[]; tz: { documents: Record<string, unknown>[] }; attachments: Record<string, unknown>[] }[];
  // Первое тело до мока не дошло (500 от сети) — записано одно, заказ ERP один
  expect(creates).toHaveLength(1);
  const body = creates[0];
  const second = [...erpUploadsByAttempt(extra).keys()].find((a) => !firstAttempt.includes(a))!;
  expect(erpUploadsByAttempt(extra).get(second)).toBe(3);
  const paths = [...body.tz.documents, ...body.attachments].map((d) => String(d.file_path));
  for (const path of paths) {
    expect(extra.storageObjects?.[`erp-attachments/${path}`], path).toBeDefined();
    expect(path).toContain(`/v4-${second}/`);
    expect(path).not.toContain(`/v4-${firstAttempt[0]}/`);
  }
  expect(body.tz.documents).toHaveLength(body.items.length);
  expect(new Set(body.tz.documents.map((d) => d.group_id)).size).toBe(body.tz.documents.length);
});

test('сбой перехода после erp_create_order: повтор — проверка отвечает «уже», только переход, без копий и второго заказа', async ({ page }) => {
  const calls: MockCall[] = [];
  const extra = flowMock(calls);
  await sentOrder(page, extra);
  await openLaunchAsMs(page, extra);
  await failOnce(page, 'order_v4_transition', (b) => b.p_to === 'production');

  await launchButton(page).click();
  await expect(page.getByRole('alert').filter({ hasText: /статус не обновился/ })).toBeFocused();
  const uploads = [...erpUploadsByAttempt(extra).values()].reduce((a, b) => a + b, 0);
  calls.splice(0);

  await launchButton(page).click();
  await expect(page.getByRole('heading', { name: /^Заказ (запущен в производство|уже запущен)$/ })).toBeFocused();
  const names = calls.filter((c) => c.kind === 'rpc' && ['order_v4_launch_check', 'erp_bootstrap', 'erp_create_order', 'order_v4_transition'].includes(c.name))
    .map((c) => c.name);
  expect(names).toEqual(['order_v4_launch_check', 'order_v4_transition']);
  expect([...erpUploadsByAttempt(extra).values()].reduce((a, b) => a + b, 0)).toBe(uploads);
  expect(v4State(extra).erpCreates).toHaveLength(1);
});

test.describe('отказы потока', () => {
  test('конфликт вкладки при отправке: другая вкладка сдвинула updated_at → «изменён в другой вкладке»', async ({ page }) => {
    const calls: MockCall[] = [];
    const extra = flowMock(calls);
    await buildOrder(page, extra);
    await markPrepaid(page);
    // «Другая вкладка»: отметка оплаты мимо стора этой вкладки — версия строки на сервере новее
    await page.evaluate(async (id) => {
      const { supabase } = await import('/src/lib/supabase.ts');
      await supabase.rpc('order_v4_set_payment', { p_id: id, p_kind: 'full', p_override_reason: null });
    }, NEW_ORDER);
    await sendButton(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Заказ изменён в другой вкладке — обновите страницу' })).toBeFocused();
    expect(rpcCalls(calls, 'order_v4_transition').filter((c) => (c.body as { p_to: string }).p_to === 'ready_to_launch')).toHaveLength(
      rpcCalls(calls, 'order_v4_transition').length,
    );
    expect(v4State(extra).orders.get(NEW_ORDER)?.status).toBe('draft');
  });

  test('знак вне шрифта («қ») в названии заказа: кнопка недоступна с причиной, пункт ведёт к полю', async ({ page }) => {
    const calls: MockCall[] = [];
    const extra = flowMock(calls);
    await buildOrder(page, extra);
    await markPrepaid(page);
    await page.getByRole('tab', { name: /^Клиент/ }).click();
    await page.getByLabel('Название заказа').fill('Футболки для Алматы қ');
    await settled(page);
    await page.getByRole('tab', { name: /^ТЗ и цена/ }).click();

    const send = sendButton(page);
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await expect(send).toHaveAccessibleDescription(/^Исправьте 1 пункт чек-листа/);
    const item = page.getByRole('list', { name: 'Чек-лист отправки' }).getByRole('listitem').filter({ hasText: 'Название заказа' });
    await expect(item).toContainText('знаки қ не напечатаются в ТЗ — замените их');
    const fix = item.getByRole('link', { name: 'Исправить' });
    await expect(fix).toHaveAttribute('href', new RegExp(`/sales/${NEW_ORDER}\\?tab=client$`));
    // `aria-disabled` — кнопка в Tab-порядке и нажимается; Playwright считает её недоступной для click()
    await send.focus();
    await page.keyboard.press('Enter');
    await expect(item).toBeFocused();
    expect(rpcCalls(calls, 'order_v4_transition')).toHaveLength(0);
    expect(storageUploads(calls, 'order-artworks').filter((p) => p.includes('/tz/'))).toHaveLength(0);
  });

  test('МС без прав производства (флаг мока) — причина сервера, заказ ERP не создаётся', async ({ page }) => {
    const calls: MockCall[] = [];
    const extra = flowMock(calls);
    await sentOrder(page, extra);
    await openLaunchAsMs(page, extra, { caller: MS, erp: { orderManage: false } });
    await launchButton(page).click();
    await expect(page.getByRole('alert')).toHaveText(`Запуск остановлен на шаге «проверка готовности»: ${J_TEXTS.erpRights}`);
    expect(v4State(extra).erpCreates).toHaveLength(0);
    expect(rpcCalls(calls, 'erp_bootstrap')).toHaveLength(0);
  });

  test('«Вернуть менеджеру»: без причины нельзя, с причиной — продавец видит плашку, повторная отправка без правок не грузит PDF', async ({ page }) => {
    const calls: MockCall[] = [];
    const extra = flowMock(calls);
    await sentOrder(page, extra);
    const tzUploads = () => storageUploads(calls, 'order-artworks').filter((p) => p.includes('/tz/')).length;
    expect(tzUploads()).toBe(1);
    await openLaunchAsMs(page, extra);

    await page.getByRole('button', { name: 'Вернуть менеджеру' }).click();
    const dialog = page.getByRole('dialog', { name: 'Вернуть менеджеру' });
    const submit = dialog.getByRole('button', { name: 'Вернуть с причиной' });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Что исправить менеджеру').fill('Уточните цвет бирки');
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Заказ возвращён менеджеру' })).toBeFocused();
    expect(rpcCalls(calls, 'order_v4_transition').at(-1)!.body).toMatchObject({ p_to: 'draft', p_reason: 'Уточните цвет бирки' });

    // Продавец снова правит: плашка с причиной над вкладками
    extra.v4 = undefined;
    await page.goto(`/sales/${NEW_ORDER}?tab=summary&studio=1`);
    await expect(page.getByRole('status').filter({ hasText: /«Уточните цвет бирки»\. Исправьте и отправьте снова$/ })).toBeVisible();
    await expect(page.getByLabel('Название заказа')).toHaveCount(0);
    await expect(sendButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await sendButton(page).click();
    await expect(page.getByRole('heading', { name: /^Отправлен в работу/ })).toBeFocused();
    // Модель не менялась — PDF прежний, новых загрузок нет
    expect(tzUploads()).toBe(1);
  });

  test('второй МС во время запуска первого: запуск — «Заказ сейчас запускает …», возврат — отказ', async ({ page }) => {
    const calls: MockCall[] = [];
    const extra = flowMock(calls);
    await sentOrder(page, extra);
    await openLaunchAsMs(page, extra, { caller: MS2, foreignLaunch: { by: MS.id, name: MS.name } });

    await launchButton(page).click();
    await expect(page.getByRole('alert')).toHaveText(`Запуск остановлен на шаге «проверка готовности»: ${J_TEXTS.launchingNow}${MS.name}${J_TEXTS.checkWait}`);
    await page.getByRole('button', { name: 'Вернуть менеджеру' }).click();
    const dialog = page.getByRole('dialog', { name: 'Вернуть менеджеру' });
    await dialog.getByLabel('Что исправить менеджеру').fill('Срок');
    await dialog.getByRole('button', { name: 'Вернуть с причиной' }).click();
    await expect(dialog.getByRole('alert')).toBeFocused();
    await expect(page.getByText(`${J_TEXTS.launchingNow}${MS.name}${J_TEXTS.returnWait}`)).toBeVisible();
    expect(v4State(extra).orders.get(NEW_ORDER)?.status).toBe('ready_to_launch');
    expect(v4State(extra).erpCreates).toHaveLength(0);
  });

  test('SVG со <script> под именем .png — отказ загрузки по байтам, нанесения и файла нет', async ({ page }) => {
    const calls: MockCall[] = [];
    const extra = flowMock(calls);
    await buildOrderUntilDesign(page, extra);
    await uploadLogo(page, 'logo-script-as.png');
    await expect(page.getByText('Содержимое файла не совпадает с расширением — сохраните его заново в PNG, SVG или PDF')).toBeVisible();
    await expect(page.getByText('На этом виде нанесений нет.')).toBeVisible();
    expect(storageUploads(calls, 'order-artworks')).toEqual([]);
  });

  test('SVG-логотип со <script>: в erp-attachments уходит только очищенный SVG', async ({ page }) => {
    const calls: MockCall[] = [];
    const extra = flowMock(calls);
    await sentOrder(page, extra, 'logo-script.svg');
    await openLaunchAsMs(page, extra);
    await launchButton(page).click();
    await expect(page.getByRole('heading', { name: 'Заказ запущен в производство' })).toBeFocused();

    const body = (v4State(extra).erpCreates[0] as { attachments: { file_path: string }[] }).attachments;
    // Очищенная копия SVG и файл печати PNG (Э4б), отрисованный из очищенного текста
    expect(body).toHaveLength(2);
    expect(body[0].file_path).toMatch(/\.svg$/);
    expect(body[1].file_path).toMatch(/\.png$/);
    const copy = extra.storageObjects![`erp-attachments/${body[0].file_path}`];
    expect(copy.type).toBe('image/svg+xml');
    const svg = copy.body.toString('utf8');
    expect(svg).toContain('<svg');
    for (const bad of ['<script', 'onload', 'onclick', 'onerror', 'javascript:', 'foreignObject', 'evil.example']) expect(svg).not.toContain(bad);
  });
});

/** Ширины проверки доступности: телефон, граница раскладки, планшет, десктоп */
const WIDTHS = [375, 760, 768, 1280] as const;

test('доступность «ТЗ и цена» и «К запуску» (375, 760, 768, 1280): axe serious/critical = 0, тач-цели «К запуску» ≥ 44 px', async ({ page }) => {
  const calls: MockCall[] = [];
  const extra = flowMock(calls);
  await buildOrder(page, extra);
  await markPrepaid(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#send')).toBeVisible();
    expect(await axeSerious(page), `«ТЗ и цена», ${width} px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await sendToWork(page);
  await openLaunchAsMs(page, extra);
  await expect(launchButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(launchButton(page)).toBeVisible();
    expect(await axeSerious(page), `«К запуску», ${width} px`).toEqual([]);
    expect(await smallTargets(page), `тач-цели «К запуску», ${width} px`).toEqual([]);
  }
});
