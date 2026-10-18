import { describe, it, expect } from 'vitest';
import { LIST_COLUMNS, SALES_CLIENT_REV, packagingKind, rowToSalesOrder, salesOrderToPayload } from './salesOrders';
import { newSalesItem, newSalesLabel, newSalesNoteCard, newSalesOrder, newSalesPrint } from '../model/factory';

/**
 * Перевод «модель ↔ база». `salesOrderToPayload` пишет ключи так, как их
 * читает `order_v4_save` (миграция 20260928213529_orders_v4), а
 * `rowToSalesOrder` читает строку вложенного select. Проверка — туда-обратно:
 * то, что RPC записал бы из payload, читается обратно той же моделью.
 */

/** Служебные колонки шапки (миграция 20261017053703): их ставят RPC, клиент читает */
const SERVICE_ROW = {
  paid_kind: 'prepaid',
  paid_override_reason: 'клиент постоянный',
  sent_at: '2026-10-17T10:00:00Z',
  launch_started_at: '2026-10-18T09:00:00Z',
  launch_by: 'u-ms',
  launched_at: '2026-10-18T09:01:00Z',
  launched_by: 'u-ms',
} as const;

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
    urgent_days: payload.urgent_days,
    discount_mode: payload.discount?.mode ?? null,
    discount_value: payload.discount?.value ?? null,
    price_total: payload.price_total,
    sticker_preview_path: payload.sticker_preview_path,
    // Служебные поля пишут RPC вехи 2, не order_v4_save: строка их несёт сама
    ...SERVICE_ROW,
    order_notes_cards: [...(payload.notes_cards ?? [])].map((c: Record<string, unknown>, j: number) => ({
      ...c, id: c.key, order_id: id, item_id: c.item_key ?? null, sort_order: j,
    })).reverse(),
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

const baseOrder = () => newSalesOrder({
  id: 'o-1',
  number: 'PH-0042',
  title: 'Дзен · футболки',
  customer: 'Дзен',
  contact: 'Анна, +7 900',
  manager: 'Илья',
  bitrix_id: '[12345]',
  due_date: '2026-10-20',
  urgent: true,
  urgent_days: 10,
  discount: { mode: 'pct', value: 5 },
  delivery_method: 'courier',
  delivery_address: 'Москва',
  packaging: 'zip',
  packaging_width_mm: 250,
  packaging_height_mm: 350,
  no_chestny_znak: true,
  sticker_preview_path: 'orders/o-1/sticker.png',
  ...SERVICE_ROW,
  items: [
    newSalesItem({
      sku_code: 'T-003',
      product_type: 'Футболка',
      fabric_code: 'medas-kulirnaya-100-160',
      client_fabric: false,
      extras: ['x1'],
      manual_unit_price: 990,
      supplier: 'Медас',
      model_description: 'Футболка оверсайз, спущенное плечо',
      extra_processing_note: 'энзимная стирка',
      client_pattern: 'лекала клиента v2',
      part_colors: { body: 'Чёрный', rib: 'Белый' },
      tz_comment: 'горловина — двойная строчка',
      tz_pdf_path: 'orders/o-1/tz/item-1.pdf',
      flat_id: 'tee-oversize',
      size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 10, M: 20 } }] },
      prints: [
        newSalesPrint({ method: 'silkscreen', zone: 'Грудь', width_mm: 200, height_mm: 150, pantone: ['186 C'], sizes: ['S'], on: 'cut', colors: 2 }),
        newSalesPrint({ method: 'embroidery', zone: 'Рукав', garment_kind: 'patch', fill: 0.6 }),
        newSalesPrint({
          method: 'other', zone: 'Спина', layout: { x: 10, y: 40, scale: 0.8 },
          artwork_path: 'orders/o-1/art/back.png', offset_mm: 70, offset_from: 'neck_seam',
          offset_dir: 'down', effects: ['puff', 'metallic'], contractor: 'Подрядчик А', contractor_days: 3,
        }),
      ],
      labels: [
        newSalesLabel({ label_type: 'care', place: 'шов' }),
        newSalesLabel({
          label_type: 'brand', blank: true, preview_paths: ['orders/o-1/labels/b1.png'],
          attach_scheme: 'вшить в боковой шов', attach_image_path: 'orders/o-1/labels/scheme.png',
        }),
      ],
    }),
    newSalesItem({ kind: 'customer', brief: 'Худи клиента', packaging_width_mm: null }),
  ],
});

/** Карточки заметок: к позиции (ключ позиции = её id) и к заказу целиком */
const fullOrder = () => {
  const o = baseOrder();
  return {
    ...o,
    notes_cards: [
      newSalesNoteCard({
        item_key: o.items[0].key, group_title: 'Референсы', caption: 'как на фото',
        link: 'https://example.com/ref', image_path: 'orders/o-1/notes/ref.png',
      }),
      newSalesNoteCard({ caption: 'Общая заметка к заказу' }),
    ],
  };
};

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
    expect(back.items[0].prints.map((p) => p.method)).toEqual(['silkscreen', 'embroidery', 'other']);
  });

  it('поля ТЗ вехи 2 и карточки заметок едут туда-обратно, порядок карточек — по sort_order', () => {
    const o = fullOrder();
    const back = rowToSalesOrder(simulateSave(salesOrderToPayload(o)));
    expect(back.items[0].prints[2]).toEqual(o.items[0].prints[2]);
    expect(back.items[0].labels[1]).toEqual(o.items[0].labels[1]);
    expect(back.items[0].part_colors).toEqual({ body: 'Чёрный', rib: 'Белый' });
    expect(back.notes_cards.map((c) => c.caption)).toEqual(['как на фото', 'Общая заметка к заказу']);
    expect(back.notes_cards[0].item_key).toBe(o.items[0].key);
    expect(back.notes_cards[1].item_key).toBeNull();
    expect(back.sticker_preview_path).toBe('orders/o-1/sticker.png');
  });

  it('без скидки — null, а не {mode: null}', () => {
    const o = newSalesOrder({ id: 'o-1' });
    expect(rowToSalesOrder(simulateSave(salesOrderToPayload(o))).discount).toBeNull();
  });
});

describe('salesOrderToPayload', () => {
  it('служебные поля шапки не уходят в order_v4_save — их ставят RPC', () => {
    const p = salesOrderToPayload(fullOrder());
    for (const k of ['status', 'erp_order_id', 'paid_at', 'paid_kind', 'paid_override_reason',
      'sent_at', 'launch_started_at', 'launch_by', 'launched_at', 'launched_by', 'number', 'created_by']) {
      expect(p).not.toHaveProperty(k);
    }
  });

  it('карточки уходят ключами — RPC берёт key как id, item_key как позицию', () => {
    const o = fullOrder();
    const p = salesOrderToPayload(o);
    expect(p.notes_cards).toEqual([
      { key: o.notes_cards[0].key, item_key: o.items[0].key, group_title: 'Референсы', caption: 'как на фото',
        link: 'https://example.com/ref', image_path: 'orders/o-1/notes/ref.png' },
      { key: o.notes_cards[1].key, item_key: null, group_title: '', caption: 'Общая заметка к заказу',
        link: '', image_path: '' },
    ]);
    expect(p.sticker_preview_path).toBe('orders/o-1/sticker.png');
  });

  it('новый заказ уходит без id — RPC создаст строку', () => {
    expect(salesOrderToPayload(newSalesOrder()).id).toBeNull();
  });

  it('ревизия клиента — в каждом сохранении (сервер отказывает устаревшей вкладке)', () => {
    expect(SALES_CLIENT_REV).toBe(4);
    expect(salesOrderToPayload(newSalesOrder()).client_rev).toBe(4);
    expect(salesOrderToPayload(fullOrder()).client_rev).toBe(4);
  });

  it('версия заказа уходит как expected_updated_at; у нового и у строки без версии ключа нет', () => {
    const v = '2026-10-17T10:00:00.123456+00:00';
    expect(salesOrderToPayload(newSalesOrder({ id: 'o-1', updated_at: v })).expected_updated_at).toBe(v);
    expect(salesOrderToPayload(newSalesOrder({ updated_at: v }))).not.toHaveProperty('expected_updated_at');
    expect(salesOrderToPayload(newSalesOrder({ id: 'o-1' }))).not.toHaveProperty('expected_updated_at');
  });

  it('версия читается из строки как есть — строкой, без потери микросекунд', () => {
    const v = '2026-10-17T10:00:00.123456+00:00';
    expect(rowToSalesOrder({ id: 'x', updated_at: v }).updated_at).toBe(v);
    expect(rowToSalesOrder({ id: 'x' }).updated_at).toBeNull();
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
    expect(o).toMatchObject({
      id: 'x', items: [], discount: null, packaging: 'none', stickers: 'none',
      notes_cards: [], sticker_preview_path: '', paid_kind: null, launched_at: null,
    });
  });

  it('строка до миграции 20261017053703 (без новых колонок) читается умолчаниями фабрики', () => {
    const o = rowToSalesOrder({
      id: 'x', order_items: [{ id: 'i', order_item_prints: [{ id: 'p', method: 'dtf' }], order_item_labels: [{ id: 'l' }] }],
    });
    expect(o.items[0]).toMatchObject({ supplier: '', part_colors: {}, flat_id: '' });
    expect(o.items[0].prints[0]).toMatchObject({ layout: null, offset_mm: null, offset_from: '', effects: [], contractor_days: null });
    expect(o.items[0].labels[0]).toMatchObject({ blank: false, preview_paths: [], attach_scheme: '' });
  });

  it('неизвестный вид оплаты читается как «нет отметки», а не как предоплата', () => {
    expect(rowToSalesOrder({ id: 'x', paid_kind: 'partial' }).paid_kind).toBeNull();
    expect(rowToSalesOrder({ id: 'x', paid_kind: null }).paid_kind).toBeNull();
    expect(rowToSalesOrder({ id: 'x', paid_kind: 'full' }).paid_kind).toBe('full');
  });

  it('битая сетка читается пустой', () => {
    const o = rowToSalesOrder({ id: 'x', order_items: [{ id: 'i', size_grid: null }] });
    expect(o.items[0].size_grid).toEqual({ sizes: [], rows: [] });
  });
});

describe('packagingKind — упаковка видами ERP', () => {
  it('прежние значения v4 переводятся: индивидуальная → other, навалом → none', () => {
    expect(packagingKind('individual', 'none')).toBe('other');
    expect(packagingKind('bulk', 'inherit')).toBe('none');
  });
  it('виды ERP — как есть, пусто и мусор — значение по умолчанию', () => {
    for (const k of ['none', 'bopp', 'zip', 'other', 'inherit']) expect(packagingKind(k, 'none')).toBe(k);
    expect(packagingKind('', 'inherit')).toBe('inherit');
    expect(packagingKind('пакет', 'none')).toBe('none');
  });
});

describe('список заказов — колонки вехи 6+7', () => {
  it('оплата, причина «без оплаты», отправка и связь с ERP читаются списком', () => {
    const cols = LIST_COLUMNS.split(',').map((c) => c.trim());
    for (const c of ['paid_kind', 'paid_override_reason', 'sent_at', 'erp_order_id', 'created_by', 'due_date', 'status']) {
      expect(cols).toContain(c);
    }
  });

  it('автор заказа читается карточкой (гейты «свой заказ»), по умолчанию — null', () => {
    expect(rowToSalesOrder({ id: 'o-1', created_by: 'u-1' }).created_by).toBe('u-1');
    expect(rowToSalesOrder({ id: 'o-1' }).created_by).toBeNull();
  });
});
