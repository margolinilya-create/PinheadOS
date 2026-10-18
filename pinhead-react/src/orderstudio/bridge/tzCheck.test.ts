import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { fixtureCatalogs, loadFixture } from '../fixtures/loadFixture.testutil';
import type { SalesOrder } from '../model/types';
import { tzDocument } from '../tz/model/tzDocument';
import { tzGroups } from '../tz/model/tzGroups';
import { tzContentHash, type Digest } from '../tz/model/tzHash';
import { tzFileName } from '../tz/model/tzFileName';
import type { TzCatalogs } from '../tz/model/tzDocTypes';
import { LAUNCH_NO_CRYPTO, TZ_MISMATCH, checkTzHashes } from './tzCheck';

/** sha-256 из node: в jsdom `crypto.subtle` нет, в проде дайджест даёт браузер */
const digest: Digest = (b) => webcrypto.subtle.digest('SHA-256', new Uint8Array(b)) as Promise<ArrayBuffer>;
const ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';

/** Пути PDF, как их записала бы отправка: хэши группы и содержимого в имени */
async function sent(order: SalesOrder, cat: TzCatalogs): Promise<SalesOrder> {
  const paths = new Map<string, string>();
  for (const g of tzGroups(order)) {
    const doc = tzDocument(order, g, cat, { issuedOn: '2026-10-18', appOrigin: 'https://example.test' });
    const name = tzFileName(order, g, doc, await tzContentHash(doc, digest));
    for (const it of g.items) paths.set(it.key, `orders/${order.id}/tz/11111111-2222-4333-8444-555555555555-${name}`);
  }
  return { ...order, items: order.items.map((it) => ({ ...it, tz_pdf_path: paths.get(it.key) ?? '' })) };
}

async function setup() {
  const cat = fixtureCatalogs();
  const { order } = loadFixture('68180-tee');
  return { cat, order: await sent({ ...order, id: ID, status: 'ready_to_launch' }, cat) };
}

describe('checkTzHashes', () => {
  it('отправленное ТЗ совпадает с моделью по данным заказа — запуск дальше', async () => {
    const { cat, order } = await setup();
    expect(tzGroups(order).length).toBeGreaterThan(1);
    expect(await checkTzHashes(order, cat, digest)).toEqual({ ok: true });
  });

  it('данные позиции изменились после отправки — расхождение', async () => {
    const { cat, order } = await setup();
    const changed = { ...order, items: order.items.map((it, i) => (i === 0 ? { ...it, tz_comment: `${it.tz_comment} правка` } : it)) };
    expect(await checkTzHashes(changed, cat, digest)).toEqual({ ok: false, reason: TZ_MISMATCH });
  });

  it('сменился справочник (подвал ТЗ) — расхождение (решение 45)', async () => {
    const { cat, order } = await setup();
    const next: TzCatalogs = { ...cat, tzSettings: { ...(cat.tzSettings ?? { footerText: '' }), footerText: 'Новый подвал' } as TzCatalogs['tzSettings'] };
    expect(await checkTzHashes(order, next, digest)).toEqual({ ok: false, reason: TZ_MISMATCH });
  });

  it('PDF из папки другого заказа или без хэша — расхождение', async () => {
    const { cat, order } = await setup();
    const other = { ...order, items: order.items.map((it) => ({ ...it, tz_pdf_path: it.tz_pdf_path.replace(ID, '99999999-9999-4999-8999-999999999999') })) };
    expect((await checkTzHashes(other, cat, digest)).ok).toBe(false);
    const bare = { ...order, items: order.items.map((it) => ({ ...it, tz_pdf_path: `orders/${ID}/tz/x.pdf` })) };
    expect((await checkTzHashes(bare, cat, digest)).ok).toBe(false);
  });

  it('ТЗ другой группы того же заказа — расхождение по хэшу группы', async () => {
    const { cat, order } = await setup();
    const [a, b] = tzGroups(order);
    const swapped = { ...order, items: order.items.map((it) => (it.key === a.items[0].key ? { ...it, tz_pdf_path: b.items[0].tz_pdf_path } : it)) };
    expect(await checkTzHashes(swapped, cat, digest)).toEqual({ ok: false, reason: TZ_MISMATCH });
  });

  it('нет криптографии — понятный отказ запуска', async () => {
    const { cat, order } = await setup();
    expect(await checkTzHashes(order, cat, null)).toEqual({ ok: false, reason: LAUNCH_NO_CRYPTO });
  });
});
