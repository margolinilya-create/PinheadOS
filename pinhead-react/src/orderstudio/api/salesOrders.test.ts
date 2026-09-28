import { describe, it, expect } from 'vitest';
import { rowToSalesOrder, salesOrderToPayload } from './salesOrders';
import { newSalesItem, newSalesLabel, newSalesOrder, newSalesPrint } from '../model/factory';

/**
 * Перевод «модель ↔ база». `salesOrderToPayload` пишет ключи так, как их
 * читает `order_v4_save` (миграция 20260928213529_orders_v4), а
 * `rowToSalesOrder` читает строку вложенного select. Проверка — туда-обратно:
 * то, что RPC записал бы из payload, читается обратно той же моделью.
 */

/** Что сделала бы RPC: payload → строки таблиц (имена колонок миграции) */
function simulateSave(payload: ReturnType<typeof salesOrderToPayload>, id = 'o-1') {
  return {
    id,
    order_number: 'PH-0042',
    schema_version: 4,
    status: 'draft',
    kind: payload.kind,
    parent_id: payload.parent_id,
    bitrix_deal: payload.bitrix_id || null,
    title: payload.title,
    customer: payload.customer,
    contact: payload.contact,
    manager_name: payload.manager,
    due_date: payload.due_date || null,
    delivery_method: payload.delivery_method,
    delivery_address: payload.delivery_address,
    packaging: payload.packaging,
    packaging_note: payload.packaging_note,
    packaging_width_mm: payload.packaging_width_mm,
    packaging_height_mm: payload.packaging_height_mm,
    stickers: payload.stickers,
    stickers_note: payload.stickers_note,
    no_chestny_znak: payload.no_chestny_znak,
    urgent: payload.urgent,
    discount_mode: payload.discount?.mode ?? null,
    discount_value: payload.discount?.value ?? null,
    price_total: payload.price_total,
    // PostgREST отдаёт вложенные строки в произвольном порядке
    order_items: [...payload.items].reverse().map((it: Record<string, unknown> & { prints: Record<string, unknown>[]; labels: Record<string, unknown>[] }, i: number, arr: unknown[]) => ({
      ...it,
      id: it.key,
      sort_order: arr.length - 1 - i,
      order_item_prints: it.prints.map((p, j) => ({ ...p, id: p.key, print_on: p.on, sort_order: j })).reverse(),
      order_item_labels: it.labels.map((l, j) => ({ ...l, id: l.key, sort_order: j })),
    })),
  };
}

const fullOrder = () => newSalesOrder({
  id: 'o-1',
  number: 'PH-0042',
  title: 'Дзен · футболки',
  customer: 'Дзен',
  contact: 'Анна, +7 900',
  manager: 'Илья',
  bitrix_id: '[12345]',
  due_date: '2026-10-20',
  urgent: true,
  discount: { mode: 'pct', value: 5 },
  delivery_method: 'courier',
  delivery_address: 'Москва',
  packaging: 'individual',
  packaging_width_mm: 250,
  packaging_height_mm: 350,
  no_chestny_znak: true,
  items: [
    newSalesItem({
      sku_code: 'T-003',
      product_type: 'Футболка',
      fabric_code: 'medas-kulirnaya-100-160',
      client_fabric: false,
      extras: ['x1'],
      manual_unit_price: 990,
      size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 10, M: 20 } }] },
      prints: [
        newSalesPrint({ method: 'silkscreen', zone: 'Грудь', width_mm: 200, height_mm: 150, pantone: ['186 C'], sizes: ['S'], on: 'cut', colors: 2 }),
        newSalesPrint({ method: 'embroidery', zone: 'Рукав', garment_kind: 'patch', fill: 0.6 }),
      ],
      labels: [newSalesLabel({ label_type: 'care', place: 'шов' })],
    }),
    newSalesItem({ kind: 'customer', brief: 'Худи клиента', packaging_width_mm: null }),
  ],
});

describe('salesOrders — туда-обратно', () => {
  it('заказ со всеми полями читается обратно тем же', () => {
    const o = fullOrder();
    const back = rowToSalesOrder(simulateSave(salesOrderToPayload(o)));
    expect(back).toEqual(o);
  });

  it('порядок позиций и нанесений — по sort_order, а не по порядку ответа', () => {
    const o = fullOrder();
    const back = rowToSalesOrder(simulateSave(salesOrderToPayload(o)));
    expect(back.items.map((i) => i.key)).toEqual(o.items.map((i) => i.key));
    expect(back.items[0].prints.map((p) => p.method)).toEqual(['silkscreen', 'embroidery']);
  });

  it('без скидки — null, а не {mode: null}', () => {
    const o = newSalesOrder({ id: 'o-1' });
    expect(rowToSalesOrder(simulateSave(salesOrderToPayload(o))).discount).toBeNull();
  });
});

describe('salesOrderToPayload', () => {
  it('новый заказ уходит без id — RPC создаст строку', () => {
    expect(salesOrderToPayload(newSalesOrder()).id).toBeNull();
  });

  it('снимок цены — в заказ и в позиции по ключу', () => {
    const o = fullOrder();
    const price = {
      total: 50000, margin_pct: 0.3,
      items: [{ key: o.items[0].key, unit: 990, total: 29700 }],
    } as unknown as Parameters<typeof salesOrderToPayload>[1];
    const p = salesOrderToPayload(o, price);
    expect(p.price_total).toBe(50000);
    expect(p.price_margin_pct).toBe(0.3);
    expect(p.items[0]).toMatchObject({ price_unit: 990, price_total: 29700 });
    expect(p.items[1]).toMatchObject({ price_unit: null, price_total: null });
  });

  it('ключи позиций, нанесений и бирок едут — RPC берёт их как id', () => {
    const o = fullOrder();
    const p = salesOrderToPayload(o);
    expect(p.items[0].key).toBe(o.items[0].key);
    expect(p.items[0].prints[0].key).toBe(o.items[0].prints[0].key);
    expect(p.items[0].labels[0].key).toBe(o.items[0].labels[0].key);
    expect(p.items[0].prints[0].on).toBe('cut');
  });
});

describe('rowToSalesOrder — строка без вложений и с пустыми полями', () => {
  it('минимальная строка не падает', () => {
    const o = rowToSalesOrder({ id: 'x', status: 'draft', schema_version: 4 });
    expect(o).toMatchObject({ id: 'x', items: [], discount: null, packaging: 'none', stickers: 'none' });
  });

  it('битая сетка читается пустой', () => {
    const o = rowToSalesOrder({ id: 'x', order_items: [{ id: 'i', size_grid: null }] });
    expect(o.items[0].size_grid).toEqual({ sizes: [], rows: [] });
  });
});
