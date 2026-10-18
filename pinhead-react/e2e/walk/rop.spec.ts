import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, type MockCall, type MockExtras } from '../support/mockSupabase';
import { draftOrder, hoodieItem, orderCatalogs, staffFx } from '../support/orderCatalogFx';
import { asProfile, inOrderSection, walkLog } from './walkFx';

/**
 * Смена РУКОВОДИТЕЛЯ ПРОДАЖ (rop; веха 8, задача 9; сценарий 3 обхода T10):
 * «Заказы отдела» и поиск; «Сотрудники продаж» — отметить продавца, журнал
 * «Кто и когда менял»; «Справочники заказа» — правка бирки, конфликт из второй вкладки.
 */

// Смена собирает заказ на холсте «Дизайн» и идёт по боковому меню — это десктоп;
// 375 px агент `pinhead-qa` проходит руками (К12), CI гоняет `@walk` только на desktop
test.beforeEach(() => test.skip(test.info().project.name !== 'desktop', 'Смена на десктопе; 375 px — обход агентом'));

const LABELS = {
  kinds: [{
    type: 'main', name: 'Основная бирка', active: true, materials: [],
    variants: [{ id: 'woven', name: 'Тканая', price: 12, withMaterial: false, active: true }],
  }],
  schemes: [{ id: 'top', name: 'Сверху по центру', active: true }],
};

function ropMock(calls: MockCall[]): MockExtras {
  const catalogs = orderCatalogs() as MockExtras['catalogs'] & { app_config: Record<string, unknown> };
  catalogs.app_config.labelLibrary = structuredClone(LABELS);
  return {
    calls,
    catalogs,
    salesStaff: staffFx(),
    salesOrders: [
      { ...draftOrder('6f1c2d3e-0000-4000-8000-0000000009a1', [hoodieItem('6f1c2d3e-0000-4000-8000-0000000009b1', 'Чёрный (40-01)')]), customer: 'ООО Ромашка', order_number: 'PH-9101', created_by: 'p-maria' },
      { ...draftOrder('6f1c2d3e-0000-4000-8000-0000000009a2', [hoodieItem('6f1c2d3e-0000-4000-8000-0000000009b2', 'Белый (01-01)')]), customer: 'ИП Лютиков', order_number: 'PH-9102', created_by: 'p-oleg' },
    ],
  };
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы заказа' });
const rows = (page: Page) => page.getByRole('main').getByRole('button', { name: /^PH-91\d\d$/ });

test('@walk rop: заказы отдела, сотрудники продаж с журналом, бирка и конфликт вкладок', async ({ page, context }) => {
  test.setTimeout(180_000);
  const calls: MockCall[] = [];
  const extra = ropMock(calls);
  await asProfile(page, 'rop');
  await installSupabaseMock(page, extra);
  const shot = walkLog(page, 'rop');

  // 1. Вход: «Заказы отдела» — заказы всех продавцов; поиск сужает список
  await page.goto('/');
  await expect(page).toHaveURL(/\/sales(\?|$)/);
  await inOrderSection(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Заказы отдела' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Поиск по клиенту и номеру' })
    .or(page.getByLabel('Поиск по клиенту и номеру')).first().fill('Лютиков');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAccessibleName('PH-9102');
  await shot('zakazy-otdela');

  // 2. «Сотрудники продаж»: отметить продавца; журнал «Кто и когда менял» показывает смену
  await nav(page).getByRole('link', { name: 'Сотрудники продаж' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сотрудники продаж');
  const seller = page.getByRole('checkbox', { name: 'Ведёт заказы: Олег Петров' });
  await expect(seller).not.toBeChecked();
  await seller.check();
  await expect(seller).toBeChecked();
  await expect(page.getByText('Продавцов: 2 · МС: 0')).toBeVisible();
  await expect.poll(() => calls.filter((c) => c.kind === 'rpc' && c.name === 'sales_set_staff').map((c) => c.body))
    .toEqual([{ p_profile: 'p-oleg', p_kind: 'sales', p_on: true }]);
  const journal = page.getByText(/^Кто и когда менял/);
  await journal.click();
  await expect(page.locator('details').filter({ hasText: 'Олег Петров' }).first()).toContainText('Ведёт заказы');
  await shot('sotrudniki-zhurnal');

  // 3. «Справочники заказа» → «Бирки»: правка варианта и сохранение
  await nav(page).getByRole('link', { name: 'Справочники заказа' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Справочники заказа');
  await page.goto('/order-settings?tab=labels');
  const name = page.getByLabel('Название: Основная бирка, вариант 1');
  await expect(name).toHaveValue('Тканая');

  // Вторая вкладка открыта ДО сохранения первой — её база устареет
  const other = await context.newPage();
  await asProfile(other, 'rop');
  await installSupabaseMock(other, extra);
  await other.goto('/order-settings?tab=labels');
  await expect(other.getByLabel('Название: Основная бирка, вариант 1')).toHaveValue('Тканая');

  await name.fill('Тканая сатин');
  await page.getByRole('button', { name: 'Сохранить бирки и схемы' }).click();
  await expect(page.getByText('Бирки и схемы сохранены')).toBeVisible();
  await shot('birka-sohranena');

  // 4. Вторая вкладка: отказ с объяснением, правка на экране, «Загрузить свежую версию»
  await other.getByLabel('Название: Основная бирка, вариант 1').fill('Тканая хлопок');
  await other.getByRole('button', { name: 'Сохранить бирки и схемы' }).click();
  const alert = other.getByRole('alert').filter({ hasText: 'уже изменили' });
  await expect(alert).toContainText('Ваши правки не сохранены');
  await expect(other.getByLabel('Название: Основная бирка, вариант 1')).toHaveValue('Тканая хлопок');
  await alert.getByRole('button', { name: 'Загрузить свежую версию' }).click();
  await expect(other.getByLabel('Название: Основная бирка, вариант 1')).toHaveValue('Тканая сатин');
  await other.close();
});
