import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, type MockCall } from '../support/mockSupabase';
import { NOW, flowMock, newOrderGetsUuid, rpcCalls, settled } from '../support/orderFlowFx';
import { CUSTOMER, TITLE, addTee, markPrepaid, placeLogo, sendToWork } from '../support/orderFlowUi';
import { asProfile, callerOf, inOrderSection, inProduction, walkLog } from './walkFx';

/**
 * Смена ПРОДАВЦА (веха 8, задача 9; сценарий 1 обхода T10). Входит — попадает
 * в «Оформление заказа»; новый заказ; изделие, цвет, размеры; логотип на холсте;
 * клиент и «Комментарий для цехов»; «ТЗ и цена» — чек-лист ведёт к пропускам;
 * «Отправить в работу»; F5 на заказе; «Производство», затем `/` — снова раздел; выход.
 */

// Смена собирает заказ на холсте «Дизайн» и идёт по боковому меню — это десктоп;
// 375 px агент `pinhead-qa` проходит руками (К12), CI гоняет `@walk` только на desktop
test.beforeEach(() => test.skip(test.info().project.name !== 'desktop', 'Смена на десктопе; 375 px — обход агентом'));

/** Шаги 1–6: вход, новый заказ, изделие, чек-лист, клиент, холст */
async function sellerBuildsOrder(page: Page, calls: MockCall[]) {
  const extra = flowMock(calls, { v4: { caller: callerOf('seller') } });
  await page.clock.setFixedTime(new Date(NOW));
  await asProfile(page, 'seller');
  await installSupabaseMock(page, extra);
  await newOrderGetsUuid(page);
  const shot = walkLog(page, 'seller');

  // 1. Вход: раздел заказа, «Мои заказы», следующее действие — «Новый заказ»
  await page.goto('/');
  await expect(page).toHaveURL(/\/sales(\?|$)/);
  await inOrderSection(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Мои заказы' })).toBeVisible();
  const newOrder = page.getByRole('main').getByRole('button', { name: 'Новый заказ' }).first();
  await expect(newOrder).toBeVisible();
  await shot('vhod');

  // 2. Новый заказ → рабочее место, следующее действие — «Добавить изделие»
  await newOrder.click();
  await expect(page).toHaveURL(/\/sales\/[^/?]+/);
  await expect(page.getByRole('button', { name: 'Добавить изделие' })).toBeVisible();
  await shot('novyi-zakaz');

  // 3. Изделие, цвет, размеры — следующая вкладка «Дизайн»
  await addTee(page);
  await expect(page.getByRole('tab', { name: /^Дизайн/ })).toBeVisible();
  await shot('izdelie');

  // 4. «ТЗ и цена» до клиента: чек-лист называет пропуск и ведёт на «Клиент»
  await page.getByRole('tab', { name: /^ТЗ и цена/ }).click();
  const checklist = page.getByRole('list', { name: 'Чек-лист отправки' });
  await expect(checklist).toBeVisible();
  await shot('chek-list-propuski');
  await checklist.getByRole('listitem').filter({ hasText: /клиент/i }).first().getByRole('link', { name: 'Исправить' }).click();
  await expect(page).toHaveURL(/tab=client/);
  await expect(page.getByLabel('Клиент', { exact: true })).toBeVisible();

  // 5. Клиент, срок, «Комментарий для цехов» — подсказка говорит, куда он попадёт
  await page.getByLabel('Клиент', { exact: true }).fill(CUSTOMER);
  await page.getByLabel('Название заказа').fill(TITLE);
  await page.getByLabel('Срок (дата в КП)').fill('2026-11-20');
  const notes = page.getByLabel('Комментарий для цехов');
  await expect(notes).toBeVisible();
  await expect(page.getByText('Попадёт в ТЗ в блок „Общее“. Видят все цеха')).toBeVisible();
  await notes.fill('Упаковать по размерам, бирки не срезать');
  await settled(page);
  await shot('klient');

  // 6. Логотип на холсте «Дизайн» — ложится в зону «Грудь (перед)»
  await placeLogo(page);
  await shot('dizain');
  return shot;
}

test('@walk продавец: от входа до отправки в работу и выхода', async ({ page }) => {
  test.setTimeout(180_000);
  const calls: MockCall[] = [];
  const shot = await sellerBuildsOrder(page, calls);

  // Без F5: у нового заказа автор известен сразу (находка обхода W1, задача 11)
  await page.getByRole('tab', { name: /^ТЗ и цена/ }).click();
  await expect(page.getByRole('button', { name: 'Отметить предоплату' })).toBeVisible();

  // 7. «ТЗ и цена»: предоплата (автор отмечает сам), чек-лист пройден, «Отправить в работу»
  await markPrepaid(page);
  await sendToWork(page);
  expect(rpcCalls(calls, 'order_v4_transition').map((c) => (c.body as { p_to: string }).p_to)).toEqual(['ready_to_launch']);
  await shot('otpravlen');

  // 8. F5 на заказе: тот же адрес, тот же заказ, правка закрыта
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await inOrderSection(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CUSTOMER);
  await expect(page.getByRole('heading', { name: /^Отправлен в работу/ })).toBeVisible();
  await shot('f5');

  // 9. «Производство» — один заход; следующий `/` — снова раздел заказа
  await page.getByRole('button', { name: 'Перейти в раздел Производство' }).click();
  await inProduction(page);
  await shot('proizvodstvo');
  await page.goto('/');
  await expect(page).toHaveURL(/\/sales(\?|$)/);
  await inOrderSection(page);

  // 10. Выход — с подтверждением, дальше форма входа
  await page.getByRole('button', { name: 'Выйти' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('button', { name: /Войти/ })).toBeVisible();
  await shot('vyhod');
});

test('@walk продавец W1: автор нового заказа отмечает оплату и отправляет без F5', async ({ page }) => {
  test.setTimeout(180_000);
  const calls: MockCall[] = [];
  await sellerBuildsOrder(page, calls);
  await page.getByRole('tab', { name: /^ТЗ и цена/ }).click();
  await expect(page.getByRole('button', { name: 'Отметить предоплату' })).toBeVisible();
  await markPrepaid(page);
  await sendToWork(page);
  expect(rpcCalls(calls, 'order_v4_transition').map((c) => (c.body as { p_to: string }).p_to)).toEqual(['ready_to_launch']);
});
