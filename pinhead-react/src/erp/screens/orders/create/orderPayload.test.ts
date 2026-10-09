import { describe, it, expect } from 'vitest';
import { emptyOrderForm, newDraftItem, type DraftItem } from '../../../utils/orderForm';
import {
  createOrderPayload,
  editOrderPayload,
  notesToSend,
  payloadItems,
  tzDocumentsPayload,
} from './orderPayload';

const form = (patch = {}) => ({ ...emptyOrderForm('2026-10-01'), title: '  BOX39  ', ...patch });
const item = (patch: Partial<DraftItem> = {}) =>
  newDraftItem({ product_type: 'футболка', qty: '10', ...patch });

describe('payloadItems', () => {
  it('отбрасывает позицию без изделия и с нулевым тиражом', () => {
    const items = [item(), item({ product_type: '  ' }), item({ qty: '0' })];
    expect(payloadItems(items)).toEqual([items[0]]);
  });
});

describe('tzDocumentsPayload', () => {
  const doc = (patch = {}) => ({
    groupId: 'g', itemIndex: null, state: 'uploaded', path: 'tz/new/a.pdf', ...patch,
  });

  it('переводит индекс позиции формы в индекс payload', () => {
    // Пустая позиция 0 в заказ не едет — ТЗ позиции 1 становится item_index 0
    const items = [item({ product_type: '' }), item()];
    const [d] = tzDocumentsPayload(items, [doc({ itemIndex: 1 })], 'Иван');
    expect(d).toMatchObject({ item_index: 0, file_path: 'tz/new/a.pdf', uploaded_by: 'Иван' });
  });

  it('пропускает незагруженные и ТЗ выпавшей позиции', () => {
    const items = [item({ product_type: '' })];
    const out = tzDocumentsPayload(items, [
      doc({ state: 'uploading' }),
      doc({ itemIndex: 0 }),
      doc(),
    ], 'Иван');
    expect(out).toHaveLength(1);
    expect(out[0].item_index).toBeNull();
  });

  it('имя и тип берёт из снимка, иначе из пути и умолчания', () => {
    const [d] = tzDocumentsPayload([], [doc()], 'Иван');
    expect(d.file_name).toBe('a.pdf');
    expect(d.mime_type).toBe('application/pdf');
    expect(d.size_bytes).toBeNull();
  });
});

describe('notesToSend', () => {
  it('пустая заметка не едет, заметка с одним изображением — едет', () => {
    const notes = [
      { key: 'a', text: '  ' },
      { key: 'b', text: 'текст' },
      { key: 'c', text: '' },
    ];
    const files = [{ ownerKey: 'c', state: 'uploaded' }, { ownerKey: 'a', state: 'error' }];
    expect(notesToSend(notes, files).map((n) => n.key)).toEqual(['b', 'c']);
  });
});

describe('createOrderPayload', () => {
  const build = (f = form(), items = [item()]) => createOrderPayload({
    form: f, validItems: items, notesList: [{ key: 'n', text: ' заметка ' }],
    tzDocuments: [], attachments: [],
  });

  it('шапка: обрезка, пустое — undefined, закупка по умолчанию нужна', () => {
    const p = build();
    expect(p.title).toBe('BOX39');
    expect(p.bitrix_id).toBeUndefined();
    expect(p.purchase_required).toBe(true);
    expect(p.notes_list).toEqual([{ seq: 1, text: 'заметка' }]);
    expect(p.tz).toEqual({ documents: [], assignments: [] });
    expect(p.materials).toEqual([]);
  });

  it('у упаковки «Нет» размер не едет', () => {
    const p = build(form({ packaging: 'none', packaging_width_mm: '100', packaging_height_mm: '200' }));
    expect(p.packaging_width_mm).toBeUndefined();
    expect(p.packaging_height_mm).toBeUndefined();
  });

  it('нанесения едут только при брендировании, эффект — только у шелкографии', () => {
    const prints = [
      { ...item().prints[0], key: 'p1', method: 'embroidery', zone: '', width_mm: '',
        height_mm: '', offset_note: '', pantone: '', special: 'глиттер', garment_kind: 'cut',
        comment: '' },
    ];
    const [off] = build(form(), [item({ has_branding: false, prints })]).items;
    expect(off.prints).toEqual([]);
    expect(off.branding_methods).toEqual([]);
    const [on] = build(form(), [item({ has_branding: true, prints })]).items;
    expect(on.prints[0]).toMatchObject({ key: 'p1', special: undefined, garment_kind: 'cut' });
    expect(on.branding_methods).toEqual(['embroidery']);
  });

  it('пустая бирка не едет, цвет / поставщик и модель — едут', () => {
    const labels = [
      { key: 'l1', label_type: '', place: '', size: '', comment: '' },
      { key: 'l2', label_type: 'размерник', place: '', size: '', comment: '' },
    ];
    const [it] = build(form(), [item({
      labels, color_supplier: ' роза, Атлас ', sku_card_id: 'card-1',
    })]).items;
    expect(it.labels).toEqual([{
      key: 'l2', label_type: 'размерник', place: undefined, size: undefined, comment: undefined,
    }]);
    expect(it.color_supplier).toBe('роза, Атлас');
    expect(it.sku_card_id).toBe('card-1');
  });

  it('источник изделия — только у готового изделия', () => {
    const [sewn] = build(form(), [item({ production_type: 'sewing', garment_source: 'customer' })]).items;
    expect(sewn.garment_source).toBeUndefined();
    const [ready] = build(form(), [item({ production_type: 'ready_garment', garment_source: 'customer' })]).items;
    expect(ready.garment_source).toBe('customer');
  });
});

describe('editOrderPayload', () => {
  it('позиции без id не едут, пустое — null, модель шлётся всегда', () => {
    const p = editOrderPayload(form(), [item({ id: 'i1' }), item()]);
    expect(p.order.title).toBe('BOX39');
    expect(p.order.bitrix_id).toBeNull();
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ id: 'i1', variant: null, sku_card_id: '', qty: 10 });
  });

  it('примечание упаковки — только у варианта «Другое»', () => {
    expect(editOrderPayload(form({ packaging: 'bopp', packaging_note: 'x' }), []).order.packaging_note)
      .toBeNull();
    expect(editOrderPayload(form({ packaging: 'other', packaging_note: ' x ' }), []).order.packaging_note)
      .toBe('x');
  });
});
