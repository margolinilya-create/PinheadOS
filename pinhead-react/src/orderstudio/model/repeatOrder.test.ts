import { describe, it, expect } from 'vitest';
import { loadFixture } from '../fixtures/loadFixture.testutil';
import { newSalesLabel, newSalesNoteCard } from './factory';
import type { SalesOrder } from './types';
import {
  attachFiles, orderFilePaths, previewSources, repeatDraft, repeatHeader, repointPath,
} from './repeatOrder';

const NEW_ID = 'a1b2c3d4-0000-4000-8000-00000000e8e8';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 67108 + бирка с превью и схемой, карточка с картинкой, стикер, PDF ТЗ и оплата */
function source(): SalesOrder {
  const { order } = loadFixture('67108');
  const base = `orders/${order.id}`;
  const it = order.items[0];
  return {
    ...order,
    status: 'production',
    number: 'PH-6710',
    bitrix_id: '[67108]',
    due_date: '2026-11-01',
    payments: [{ kind: 'prepay', amount: 1000, paid_on: '2026-10-01' }],
    paid_kind: 'prepay',
    sent_at: '2026-10-02T10:00:00Z',
    erp_order_id: 'erp-1',
    sticker_preview_path: `${base}/sticker/s.png`,
    items: [{
      ...it,
      tz_pdf_path: `${base}/tz/x.pdf`,
      prints: it.prints.map((p, i) => (i === 0 ? { ...p, layout: { ...(p.layout as object), asset: { ...(p.layout as { asset: object }).asset, has_preview: true } } } : p)),
      labels: [newSalesLabel({ preview_paths: [`${base}/label/a.png`, `${base}/label/b.png`], attach_image_path: `${base}/label/scheme.png` })],
    }],
    notes_cards: [newSalesNoteCard({ item_key: it.key, image_path: `${base}/note/n.jpg` })],
  };
}

describe('repeatOrder — модель повтора (веха 5в, Э8)', () => {
  it('repointPath: тот же хвост в папке нового заказа; не путь заказа — null', () => {
    expect(repointPath('orders/6f710800-0000-4000-8000-000000067108/logo/a.png', NEW_ID.toUpperCase())).toBe(`orders/${NEW_ID}/logo/a.png`);
    expect(repointPath('flats/tshirt/v1/front.svg', NEW_ID)).toBeNull();
    expect(repointPath('orders/not-a-uuid/logo/a.png', NEW_ID)).toBeNull();
  });

  it('шапка: клиент, упаковка, доставка, скидка; parent_id — источник; без срока, оплат, сделки, служебных', () => {
    const src = source();
    const h = repeatHeader(src);
    expect(h).toMatchObject({ parent_id: src.id, customer: src.customer, title: src.title, kind: src.kind });
    for (const k of ['id', 'number', 'status', 'due_date', 'payments', 'bitrix_id', 'paid_kind', 'sent_at', 'erp_order_id', 'created_by', 'updated_at', 'items']) {
      expect(h).not.toHaveProperty(k);
    }
  });

  it('файлы: макеты, бирки, карточки, стикер — без PDF ТЗ и без повторов; превью — только у PDF/AI', () => {
    const src = source();
    const paths = orderFilePaths(src);
    expect(paths).toHaveLength(5 + 3 + 1 + 1);
    expect(paths.some((p) => p.includes('/tz/'))).toBe(false);
    expect([...previewSources(src)]).toEqual([src.items[0].prints[0].artwork_path]);
  });

  it('черновик без файлов: все ключи новые (UUID), пути пусты, нанесение с файлом без раскладки, PDF ТЗ пуст', () => {
    const src = source();
    const { seed, links } = repeatDraft(src);
    const it = seed.items[0];
    const old = src.items[0];
    expect(it.key).toMatch(UUID);
    expect(it.key).not.toBe(old.key);
    it.prints.forEach((p, i) => {
      expect(p.key).toMatch(UUID);
      expect(p.key).not.toBe(old.prints[i].key);
      expect(p.artwork_path).toBe('');
      expect(p.applied_at).toBeNull();
      expect(p.layout).toBe(old.prints[i].artwork_path ? null : old.prints[i].layout);
      expect([p.width_mm, p.method, p.zone]).toEqual([old.prints[i].width_mm, old.prints[i].method, old.prints[i].zone]);
    });
    expect(it.tz_pdf_path).toBe('');
    expect(it.labels[0]).toMatchObject({ preview_paths: [], attach_image_path: '' });
    expect(seed.notes_cards[0]).toMatchObject({ item_key: it.key, image_path: '' });
    expect(seed.sticker_preview_path).toBe('');
    expect(it.size_grid).toEqual(old.size_grid);
    expect(it.size_grid).not.toBe(old.size_grid);
    expect(links).toHaveLength(5 + 2 + 1 + 1);
  });

  it('привязка: скопированное — на месте с раскладкой; не скопированное — пусто, «Не размещено», счёт', () => {
    const src = source();
    const draft = repeatDraft(src);
    const map = Object.fromEntries(orderFilePaths(src).map((p) => [p, repointPath(p, NEW_ID)!]));
    const lost = src.items[0].prints[1].artwork_path;
    delete map[lost];
    delete map[src.items[0].labels[0].preview_paths[1]];
    const order = { ...src, id: NEW_ID, ...draft.seed };
    const { order: done, dropped } = attachFiles(order, draft.links, map);
    expect(dropped).toBe(2);
    const prints = done.items[0].prints;
    expect(prints[0].artwork_path).toBe(`orders/${NEW_ID}/logo/a0000001-front.png`);
    expect(prints[0].layout).toEqual(src.items[0].prints[0].layout);
    expect(prints[1]).toMatchObject({ artwork_path: '', layout: null });
    expect(done.items[0].labels[0].preview_paths).toEqual([`orders/${NEW_ID}/label/a.png`]);
    expect(done.items[0].labels[0].attach_image_path).toBe(`orders/${NEW_ID}/label/scheme.png`);
    expect(done.notes_cards[0].image_path).toBe(`orders/${NEW_ID}/note/n.jpg`);
    expect(done.sticker_preview_path).toBe(`orders/${NEW_ID}/sticker/s.png`);
    const all = JSON.stringify(done.items) + JSON.stringify(done.notes_cards) + done.sticker_preview_path;
    expect(all).not.toContain(src.id);
  });

  it('привязка по ключам: строку, удалённую до конца копий, пропускаем; прочие правки черновика сохраняются', () => {
    const src = source();
    const draft = repeatDraft(src);
    const map = Object.fromEntries(orderFilePaths(src).map((p) => [p, repointPath(p, NEW_ID)!]));
    const edited = { ...src, id: NEW_ID, ...draft.seed, title: 'Правка во время копий' };
    edited.items = [{ ...edited.items[0], prints: edited.items[0].prints.slice(1) }];
    const { order: done } = attachFiles(edited, draft.links, map);
    expect(done.title).toBe('Правка во время копий');
    expect(done.items[0].prints).toHaveLength(src.items[0].prints.length - 1);
    expect(done.items[0].prints[0].artwork_path).toBe(`orders/${NEW_ID}/logo/a0000002-back1.svg`);
  });
});
