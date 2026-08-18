import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Мост «ТЗ → производство».
 *
 * ЧТО ЭТО СТОРОЖИТ. До моста менеджер оформлял техническое задание в визарде,
 * а потом ПЕРЕБИВАЛ тот же заказ руками в форму производства: размерную сетку,
 * нанесения, техблок, лист закупки. Расхождение обнаруживалось в цехе.
 *
 * Проверяется именно СТЫК: раскладку полей покрывает `tzBridge.test.ts`
 * (чистая функция), а здесь — что данные доезжают до настоящей формы и что
 * повторная отправка одного ТЗ не открывает бланк заново.
 */

const TZ_ID = '11111111-2222-3333-4444-555555555555';

const TZ_ORDER = {
  id: TZ_ID,
  order_number: 'PH-0042',
  status: 'approved',
  erp_order_id: null,
  total_sum: 125000,
  total_qty: 30,
  item_type: 'tee',
  bitrix_deal: '9001',
  created_at: '2026-08-17T10:00:00Z',
  data: {
    name: 'Ромашка',
    managerName: 'Иванов',
    bitrixDeal: '9001',
    deadline: '2026-09-15',
    address: 'Москва, Тверская 1',
    total: 125000,
    items: [{
      type: 'tee',
      sku: { code: 'T-005', name: 'Футболка Oversize', fit: 'oversize', trimCode: 'ribana-1x1' },
      color: '01-01',
      fabric: 'kulirka-160',
      fit: 'oversize',
      sizes: { S: 10, M: 20 },
      customSizes: [],
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 2, size: 'A3', textile: 'white', fx: 'none' } },
      designNotes: 'логотип по центру',
    }],
  },
};

const CATALOGS = [
  { key: 'sku_catalog', value: [{ code: 'T-005', name: 'Футболка Oversize', fit: 'oversize' }] },
  { key: 'fabricsCatalog', value: [{ code: 'kulirka-160', name: 'Кулирка', density: 160 }] },
  { key: 'trimCatalog', value: [{ code: 'ribana-1x1', name: 'Рибана 1×1' }] },
  { key: 'zonesCatalog', value: [{ id: 'front', name: 'Грудь' }] },
];

test.describe('ТЗ → производственный заказ', () => {
  test('форма открывается заполненной из ТЗ', async ({ page }) => {
    await installSupabaseMock(page, { tzOrders: [TZ_ORDER], catalogs: CATALOGS });
    await page.goto(`/orders?fromTz=${TZ_ID}&studio=0`);

    // Заголовок называет источник: человек должен видеть, что это не пустой бланк
    await expect(page.getByText('Заказ из ТЗ PH-0042')).toBeVisible();

    // Шапка заказа
    await expect(page.getByRole('textbox', { name: /Название/ })).toHaveValue(/PH-0042 · Ромашка/);
    await expect(page.locator('input').filter({ hasText: '' }).first()).toBeVisible();

    // Позиция: изделие из каталога, крой, цвет
    await expect(page.getByText('Футболка Oversize').first()).toBeVisible();

    // Что осталось в ТЗ — названо, а не потеряно молча
    await expect(page.getByText(/Осталось в ТЗ/)).toBeVisible();
    await expect(page.getByText(/125/)).toBeVisible();
  });

  test('уже отправленное ТЗ не открывает форму заново', async ({ page }) => {
    // Второй заказ по одному ТЗ запрещён уникальным индексом на сервере;
    // интерфейс обязан объяснить это ДО того, как человек заполнит форму
    await installSupabaseMock(page, {
      tzOrders: [{ ...TZ_ORDER, erp_order_id: '99999999-0000-0000-0000-000000000000' }],
      catalogs: CATALOGS,
    });
    await page.goto(`/orders?fromTz=${TZ_ID}&studio=0`);

    // Баннер, а не тост: тост живёт три секунды и до человека может
    // не дожить — а ответ «почему формы нет» обязан его дождаться
    await expect(page.getByText(/уже отправлено в производство/)).toBeVisible();
    await expect(page.getByText('Заказ из ТЗ PH-0042')).toHaveCount(0);
  });

  test('ТЗ не найдено — форма не открывается, причина названа', async ({ page }) => {
    await installSupabaseMock(page, { tzOrders: [], catalogs: CATALOGS });
    await page.goto('/orders?fromTz=00000000-0000-0000-0000-000000000000&studio=0');

    await expect(page.getByText(/ТЗ не найдено/)).toBeVisible();
    await expect(page.getByText(/Заказ из ТЗ/)).toHaveCount(0);
  });
});
