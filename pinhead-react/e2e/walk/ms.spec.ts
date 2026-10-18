import { test, expect, type Page } from '@playwright/test';
import { type MockCall } from '../support/mockSupabase';
import { NEW_ORDER, flowMock, rpcCalls } from '../support/orderFlowFx';
import { buildOrder, launchButton, sendButton, sendToWork } from '../support/orderFlowUi';
import { asProfile, callerOf, inOrderSection, walkLog } from './walkFx';

/**
 * Смена МС (веха 8, задача 9; сценарий 2 обхода T10). Заказ собирает и отправляет
 * руководство продаж (dev-админ) — сборку продавцом проходит смена продавца.
 * МС: «К запуску»; оплата «Предоплата»; «Вернуть менеджеру» с причиной;
 * повторная отправка; «Запустить в производство»; «Отметить: заказ сдан».
 */

// Смена собирает заказ на холсте «Дизайн» и идёт по боковому меню — это десктоп;
// 375 px агент `pinhead-qa` проходит руками (К12), CI гоняет `@walk` только на desktop
test.beforeEach(() => test.skip(test.info().project.name !== 'desktop', 'Смена на десктопе; 375 px — обход агентом'));

/** Вход МС «с порога»: оболочка выбирается при загрузке, «Заказы в работе» */
async function msEnters(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sales(\?|$)/);
  await inOrderSection(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Заказы в работе' })).toBeVisible();
}

/** «К запуску» в меню → строка заказа → экран запуска */
async function openLaunch(page: Page) {
  await page.getByRole('link', { name: 'К запуску' }).click();
  await expect(page).toHaveURL(/status=ready_to_launch/);
  await page.getByRole('main').getByRole('button', { name: 'PH-9001', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('К запуску: PH-9001');
}

test('@walk МС: оплата, возврат, повторная отправка, запуск и «сдан»', async ({ page }) => {
  test.setTimeout(240_000);
  const calls: MockCall[] = [];
  const extra = flowMock(calls);
  await buildOrder(page, extra);
  await sendToWork(page);

  // 1. МС входит: «Заказы в работе»; следующее действие — «К запуску»
  await asProfile(page, 'ms');
  extra.v4 = { caller: callerOf('ms') };
  const shot = walkLog(page, 'ms');
  await msEnters(page);
  await expect(page.getByRole('link', { name: 'К запуску' })).toBeVisible();
  await shot('vhod');

  // 2. Экран запуска: без оплаты запуск недоступен, следующее — отметить оплату
  await openLaunch(page);
  await expect(launchButton(page)).toHaveAttribute('aria-disabled', 'true');
  const prepaid = page.getByRole('button', { name: 'Отметить предоплату' });
  await expect(prepaid).toBeVisible();
  await shot('k-zapusku');

  // 3. «Предоплата» — МС подтверждает отметку; запуск становится доступен
  await prepaid.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отметить' }).click();
  await expect(page.getByText(/^Предоплата получена/).first()).toBeVisible();
  await expect(launchButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  expect(rpcCalls(calls, 'order_v4_set_payment').at(-1)!.body).toMatchObject({ p_kind: 'prepaid' });
  await shot('predoplata');

  // 4. «Вернуть менеджеру»: без причины нельзя, с причиной — «Заказ возвращён менеджеру»
  await page.getByRole('button', { name: 'Вернуть менеджеру' }).click();
  const dialog = page.getByRole('dialog', { name: 'Вернуть менеджеру' });
  await expect(dialog.getByRole('button', { name: 'Вернуть с причиной' })).toBeDisabled();
  await dialog.getByLabel('Что исправить менеджеру').fill('Уточните срок');
  await dialog.getByRole('button', { name: 'Вернуть с причиной' }).click();
  await expect(page.getByRole('heading', { name: 'Заказ возвращён менеджеру' })).toBeFocused();
  await shot('vozvrat');

  // 5. Менеджер видит причину и отправляет снова (руководство продаж — dev-админ)
  await asProfile(page, 'admin');
  extra.v4 = undefined;
  await page.goto(`/sales/${NEW_ORDER}?tab=summary`);
  await expect(page.getByRole('status').filter({ hasText: /«Уточните срок»\. Исправьте и отправьте снова$/ })).toBeVisible();
  await sendButton(page).click();
  await expect(page.getByRole('heading', { name: /^Отправлен в работу/ })).toBeFocused();

  // 6. МС снова: «Запустить в производство» → «Заказ запущен в производство»
  await asProfile(page, 'ms');
  extra.v4 = { caller: callerOf('ms') };
  await msEnters(page);
  await openLaunch(page);
  await launchButton(page).click();
  await expect(page.getByRole('heading', { name: 'Заказ запущен в производство' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Открыть PH-9001 в производстве' })).toBeVisible();
  await shot('zapushen');

  // 7. Заказ в производстве: «Отметить: заказ сдан» — с подтверждением, статус «Сдан»
  await page.goto(`/sales/${NEW_ORDER}`);
  const done = page.getByRole('button', { name: 'Отметить: заказ сдан' });
  await expect(done).toBeVisible();
  await done.click();
  await page.getByRole('dialog').getByRole('button', { name: /Сдан|Отметить|Да/ }).click();
  await expect(done).toHaveCount(0);
  expect(rpcCalls(calls, 'order_v4_transition').map((c) => (c.body as { p_to: string }).p_to))
    .toEqual(['ready_to_launch', 'draft', 'ready_to_launch', 'production', 'done']);
  await shot('sdan');
});
