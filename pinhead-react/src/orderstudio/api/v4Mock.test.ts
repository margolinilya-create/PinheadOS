// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mockAnswersForTest as mock, type MockExtras } from '../../../e2e/support/mockSupabase';
import { J_TEXTS, v4State } from '../../../e2e/support/mock/orderV4Rpc';
import { erpUploadsByAttempt } from '../../../e2e/support/mock/storageBuckets';

/**
 * Мок e2e под контракт миграции J (веха 6+7, задача 4): поведение, по
 * которому e2e проверяют экраны отправки, оплаты и запуска. Тексты сверяет
 * со SQL сторож `mockContract.test.ts`; здесь — ветки и форма ответов.
 */
const ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const SELLER = { id: 'u-seller', name: 'Мария', role: 'production', is_sales: true };
const MS = { id: 'u-ms', name: 'Анна', role: 'manager', is_ms: true };
const ROP = { id: 'u-rop', name: 'Ольга', role: 'rop' };

const pdf = (size = 10) => ({ type: 'application/pdf', body: Buffer.alloc(size, 0x25) });

function draft(extra: Partial<MockExtras> = {}, row: Record<string, unknown> = {}): MockExtras {
  const tz = `orders/${ID}/tz/aa-PH-9001-g1-c2.pdf`;
  const art = `orders/${ID}/logo/bb-logo.png`;
  return {
    salesOrders: [{
      id: ID, schema_version: 4, status: 'draft', created_by: SELLER.id, order_number: 'PH-9001',
      customer: 'ООО Ромашка', due_date: '2026-10-30', updated_at: 'v1', paid_at: null, paid_kind: null,
      order_items: [{ id: 'i1', tz_pdf_path: tz, order_item_prints: [{ id: 'p1', method: 'dtf', artwork_path: art }, { id: 'p2', method: 'other', artwork_path: '' }] }],
      ...row,
    }],
    storageObjects: { [`order-artworks/${tz}`]: pdf(), [`order-artworks/${art}`]: { type: 'image/png', body: Buffer.from('png') } },
    v4: { caller: SELLER },
    ...extra,
  };
}

const rpc = (fn: string, body: Record<string, unknown>, extra: MockExtras) => mock.rpc(fn, body, extra) as
  { data?: Record<string, unknown>; error?: { code: string; message: string } };

describe('отправка в работу (draft → ready_to_launch)', () => {
  it('автор по is_sales с PDF и макетом — успех, ответ с updated_at и sent_at', () => {
    const r = rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch', p_reason: null, p_expected_updated_at: 'v1' }, draft());
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({ id: ID, status: 'ready_to_launch', erp_order_id: null });
    expect(r.data?.updated_at).toEqual(expect.any(String));
    expect(r.data?.updated_at).not.toBe('v1');
    expect(r.data?.sent_at).toEqual(expect.any(String));
  });

  it('устаревший expected_updated_at — «изменён в другой вкладке» раньше проверок ТЗ', () => {
    const e = draft({}, { order_items: [{ id: 'i1', tz_pdf_path: '', order_item_prints: [] }] });
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch', p_expected_updated_at: 'old' }, e).error)
      .toEqual({ code: 'P0001', message: J_TEXTS.conflict });
  });

  it('PDF чужого заказа, не в /tz/ или без объекта — «Сформируйте ТЗ»', () => {
    for (const p of [`orders/ffffffff-1d2a-4c3b-8e4f-5a6b7c8d9e0f/tz/x.pdf`, `orders/${ID}/logo/x.pdf`, `orders/${ID}/tz/missing.pdf`]) {
      const e = draft({}, { order_items: [{ id: 'i1', tz_pdf_path: p, order_item_prints: [] }] });
      expect(rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch' }, e).error?.message).toBe(J_TEXTS.noTzPdf);
    }
  });

  it('объект не PDF или больше 8 МБ — «Сформируйте ТЗ»', () => {
    const tz = `orders/${ID}/tz/aa-PH-9001-g1-c2.pdf`;
    const svg = draft();
    svg.storageObjects![`order-artworks/${tz}`] = { type: 'image/svg+xml', body: Buffer.from('<svg/>') };
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch' }, svg).error?.message).toBe(J_TEXTS.noTzPdf);
    const big = draft();
    big.storageObjects![`order-artworks/${tz}`] = pdf(8388609);
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch' }, big).error?.message).toBe(J_TEXTS.noTzPdf);
  });

  it('dtf без макета — «У нанесения нет макета»; other без макета — можно', () => {
    const e = draft({}, { order_items: [{ id: 'i1', tz_pdf_path: `orders/${ID}/tz/aa-PH-9001-g1-c2.pdf`, order_item_prints: [{ id: 'p1', method: 'dtf', artwork_path: '' }] }] });
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch' }, e).error?.message).toBe(J_TEXTS.noArtwork);
  });

  it('manager без is_sales — заказ скрыт (42501)', () => {
    const e = draft({ v4: { caller: { id: SELLER.id, name: 'М', role: 'manager' } } });
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch' }, e).error).toEqual({ code: '42501', message: J_TEXTS.hidden });
  });
});

describe('оплата', () => {
  const ready = (caller: object, row: Record<string, unknown> = {}, erp?: object) =>
    draft({ v4: { caller: caller as typeof MS, ...(erp ? { erp } : {}) } }, { status: 'ready_to_launch', ...row });

  it('МС: prepaid в ready_to_launch — успех, ответ с updated_at и status', () => {
    const r = rpc('order_v4_set_payment', { p_id: ID, p_kind: 'prepaid', p_override_reason: null }, ready(MS));
    expect(r.data).toMatchObject({ paid_kind: 'prepaid', status: 'ready_to_launch' });
    expect(r.data?.updated_at).toEqual(expect.any(String));
  });

  it('МС: снять, причина, свой заказ, без order.manage — отказы J', () => {
    expect(rpc('order_v4_set_payment', { p_id: ID, p_kind: null }, ready(MS)).error?.message).toBe(J_TEXTS.msOnlyMark);
    expect(rpc('order_v4_set_payment', { p_id: ID, p_kind: 'full', p_override_reason: 'x' }, ready(MS)).error?.message).toBe(J_TEXTS.msOnlyMark);
    expect(rpc('order_v4_set_payment', { p_id: ID, p_kind: 'full' }, ready(MS, { created_by: MS.id })).error?.message).toBe(J_TEXTS.msOwnPayment);
    expect(rpc('order_v4_set_payment', { p_id: ID, p_kind: 'full' }, ready(MS, {}, { orderManage: false })).error?.message).toBe(J_TEXTS.msNoErpPayment);
  });

  it('МС в черновике заказа не видит (42501)', () => {
    expect(rpc('order_v4_set_payment', { p_id: ID, p_kind: 'full' }, draft({ v4: { caller: MS } })).error?.code).toBe('42501');
  });

  it('rop с причиной — успех; событие оплаты в журнале', () => {
    const e = ready(ROP);
    expect(rpc('order_v4_set_payment', { p_id: ID, p_kind: null, p_override_reason: 'постоянный клиент' }, e).data)
      .toMatchObject({ paid_override_reason: 'постоянный клиент' });
    const ev = mock.table('order_events', `order_id=eq.${ID}&kind=eq.payment&reason=not.is.null`, e) as Record<string, unknown>[];
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ reason: 'постоянный клиент', actor: ROP.id });
  });
});

describe('проверка запуска и переход в производство', () => {
  const paid = (extra: Partial<MockExtras> = {}) =>
    draft({ v4: { caller: MS }, ...extra }, { status: 'ready_to_launch', paid_at: 't', paid_kind: 'full' });

  it('каждый ответ — с launched; нет прав ERP — отказ до метки', () => {
    const e = paid({ v4: { caller: MS, erp: { tzManage: false } } });
    const r = rpc('order_v4_launch_check', { p_id: ID }, e);
    expect(r.data).toMatchObject({ ok: false, reason: J_TEXTS.erpRights, launched: false });
    expect(v4State(e).orders.get(ID)?.launchAt).toBeNull();
  });

  it('чужая свежая метка — отказ с именем; возврат при ней — P0001', () => {
    const e = paid({ v4: { caller: MS, foreignLaunch: { by: 'u-other', name: 'Пётр' } } });
    expect(rpc('order_v4_launch_check', { p_id: ID }, e).data?.reason)
      .toBe(`${J_TEXTS.launchingNow}Пётр${J_TEXTS.checkWait}`);
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'draft', p_reason: 'нет размеров' }, e).error?.message)
      .toBe(`${J_TEXTS.launchingNow}Пётр${J_TEXTS.returnWait}`);
  });

  it('свой заказ МС не запускает', () => {
    const e = draft({ v4: { caller: MS } }, { status: 'ready_to_launch', paid_at: 't', paid_kind: 'full', created_by: MS.id });
    expect(rpc('order_v4_launch_check', { p_id: ID }, e).data?.reason).toBe(J_TEXTS.ownOrder);
  });

  it('метка → erp_create_order → переход с p_erp_order_id этого запуска; без него или с чужим — отказ', () => {
    const e = paid();
    expect(rpc('order_v4_launch_check', { p_id: ID }, e).data).toMatchObject({ ok: true, already: false, launched: false });
    const created = rpc('erp_create_order', { payload: { tz_order_id: ID, items: [], attachments: [] } }, e).data as unknown as string;
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'production' }, e).error?.message).toBe(J_TEXTS.erpNotThisLaunch);
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'production', p_erp_order_id: 'other' }, e).error?.message).toBe(J_TEXTS.erpNotThisLaunch);
    const ok = rpc('order_v4_transition', { p_id: ID, p_to: 'production', p_erp_order_id: created }, e);
    expect(ok.data).toMatchObject({ status: 'production', erp_order_id: created });
    expect(ok.data?.updated_at).toEqual(expect.any(String));
    expect(rpc('order_v4_launch_check', { p_id: ID }, e).data).toMatchObject({ ok: true, already: true, launched: true });
  });

  it('erp_create_order: ключи нанесений и бирок → номер, неизвестный ключ выбрасывается', () => {
    const e = paid();
    rpc('order_v4_launch_check', { p_id: ID }, e);
    rpc('erp_create_order', { payload: {
      tz_order_id: ID,
      items: [{ prints: [{ key: 'pk1' }, { key: 'pk2' }], labels: [{ key: 'lk1' }] }],
      attachments: [
        { item_index: 0, print_key: 'pk2', kind: 'print', file_path: 'att/a.png' },
        { item_index: 0, label_key: 'lk1', kind: 'label', file_path: 'att/b.png' },
        { item_index: 0, print_key: 'gone', kind: 'print', file_path: 'att/c.png' },
      ],
    } }, e);
    const rows = mock.table('erp_order_attachments', 'order_id=eq.mock-erp-order-1&kind=in.(print,label)', e) as Record<string, unknown>[];
    expect(rows.map((r) => [r.kind, r.print_index ?? r.label_index])).toEqual([['print', 1], ['label', 0]]);
    expect(v4State(e).erpCreates).toHaveLength(1);
  });

  it('rop заказ не возвращает (К17)', () => {
    const e = paid({ v4: { caller: ROP } });
    expect(rpc('order_v4_transition', { p_id: ID, p_to: 'draft', p_reason: 'x' }, e).error?.message).toBe(J_TEXTS.returnRights);
  });
});

describe('sales_set_staff и erp-attachments', () => {
  it('rop не отмечает себя; МС руководителю продаж — только admin/director', () => {
    const staff = [{ id: ROP.id, role: 'rop', is_ms: false }, { id: 'u-rop2', role: 'rop', is_ms: false }];
    const e: MockExtras = { salesStaff: staff, v4: { caller: ROP } };
    expect(rpc('sales_set_staff', { p_profile: ROP.id, p_kind: 'ms', p_on: true }, e).error?.message).toBe(J_TEXTS.staffSelf);
    expect(rpc('sales_set_staff', { p_profile: 'u-rop2', p_kind: 'ms', p_on: true }, e).error?.message).toBe(J_TEXTS.staffRopMs);
    const admin: MockExtras = { salesStaff: staff };
    expect(rpc('sales_set_staff', { p_profile: 'u-rop2', p_kind: 'ms', p_on: true }, admin).error).toBeUndefined();
    expect(staff[1].is_ms).toBe(true);
  });

  it('erp-attachments: повтор ключа — 409 даже без карты объектов, больше 30 МБ — 413, счёт по попытке', () => {
    const e: MockExtras = {};
    const key = 'erp-attachments/tz/v4-1f0e2d3c-4b5a-4968-8776-655443322110/g/v1-tz.pdf';
    expect(mock.storageWrite(key, 'application/pdf', Buffer.from('%PDF-'), undefined, e).status).toBe(200);
    const dup = mock.storageWrite(key, 'application/pdf', Buffer.from('%PDF-'), undefined, e);
    expect(dup.status).toBe(400);
    expect(dup.body).toMatchObject({ statusCode: '409', error: 'Duplicate' });
    const big = mock.storageWrite(`${key}.2`, 'application/pdf', Buffer.alloc(30 * 1024 * 1024 + 1), undefined, e);
    expect(big.status).toBe(413);
    expect(erpUploadsByAttempt(e).get('1f0e2d3c-4b5a-4968-8776-655443322110')).toBe(1);
  });
});

describe('состояние строки между RPC и сохранением (задача 7)', () => {
  it('сохранение после оплаты и отправки не стирает колонки, которые пишут только RPC J', () => {
    const e = draft({ v4: { caller: { id: 'dev', name: 'Dev', role: 'admin' } } });
    rpc('order_v4_set_payment', { p_id: ID, p_kind: 'prepaid', p_override_reason: null }, e);
    const save = rpc('order_v4_save_full', { p_order: { id: ID, client_rev: 4, customer: 'ООО Ромашка', items: [] } }, e);
    expect(save.error).toBeUndefined();
    const [row] = mock.table('orders', `schema_version=eq.4&id=eq.${ID}`, e) as Record<string, unknown>[];
    expect(row).toMatchObject({ status: 'draft', paid_kind: 'prepaid', paid_override_reason: null });
    expect(row.paid_at).toEqual(expect.any(String));
  });

  it('журнал идёт по времени: возврат свежее отправки (плашка причины у продавца)', () => {
    const e = draft({ v4: { caller: { id: 'dev', name: 'Dev', role: 'admin' } } });
    const sent = rpc('order_v4_transition', { p_id: ID, p_to: 'ready_to_launch' }, e).data!;
    rpc('order_v4_transition', { p_id: ID, p_to: 'draft', p_reason: 'Цвет' }, e);
    const [ret] = mock.table('order_events', `order_id=eq.${ID}&kind=eq.status&from_status=eq.ready_to_launch&to_status=eq.draft`, e) as
      { at: string }[];
    expect(Date.parse(ret.at)).toBeGreaterThan(Date.parse(String(sent.sent_at)));
  });
});
