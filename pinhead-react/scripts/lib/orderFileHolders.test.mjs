// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  MIN_AGE_MS,
  PAGE,
  deleteAllowed,
  orderArtworksReport,
  garmentFlatsReport,
  runReport,
  reportNumbers,
} from './orderFileHolders.mjs';

/**
 * Отчёт уборки `order-artworks` и `garment-flats` (веха 8, задача 7, К8):
 * кандидат — файл, которого не держит НИ колонка, НИ текст строк заказа,
 * НИ версия флэта; ошибка любой выборки = ничего. Всё — на поддельном
 * клиенте Supabase: форма вызовов та же, что у supabase-js.
 */

const NOW = Date.parse('2026-10-18T12:00:00Z');
const OLD = new Date(NOW - MIN_AGE_MS - 3600_000).toISOString();
const YOUNG = new Date(NOW - 3600_000).toISOString();

const ORDER = '11111111-2222-4333-8444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PRINT = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const p = (name) => `orders/${ORDER}/${name}`;

/**
 * Поддельный клиент: таблицы — массивы строк, бакеты — массивы
 * `{ path, size, createdAt }`. `opts.lieCount[table]` — сдвиг `count`
 * (имитация строки, появившейся между страницами), `opts.firstPageDrift[table]` —
 * `count` первой страницы другой, чем у остальных, `opts.fail[table]` —
 * ошибка выборки, `opts.failList[bucket]` — ошибка листинга.
 */
function fakeDb(tables, buckets, opts = {}) {
  const calls = [];
  const from = (table) => {
    const state = { filters: [], from: 0, to: Infinity, cols: '*' };
    const q = {
      select(cols, o) { state.cols = cols; state.count = o?.count; return q; },
      eq(col, v) { state.filters.push((r) => r[col] === v); return q; },
      in(col, vs) { state.filters.push((r) => vs.includes(r[col])); return q; },
      not(col, op, v) { state.filters.push((r) => !(op === 'is' && v === null && r[col] == null)); return q; },
      order() { return q; },
      range(a, b) { state.from = a; state.to = b; return q; },
      then(resolve) {
        calls.push(table);
        if (opts.fail?.[table]) return resolve({ data: null, error: { message: 'сбой' }, count: null });
        const rows = (tables[table] ?? []).filter((r) => state.filters.every((f) => f(r)));
        const page = rows.slice(state.from, state.to + 1);
        const drift = state.from === 0 ? (opts.firstPageDrift?.[table] ?? 0) : 0;
        const count = state.count === 'exact' ? rows.length + (opts.lieCount?.[table] ?? 0) + drift : null;
        return resolve({ data: page, error: null, count });
      },
    };
    return q;
  };
  const storage = {
    from(bucket) {
      return {
        async list(prefix, { limit, offset }) {
          if (opts.failList?.[bucket]) return { data: null, error: { message: 'нет доступа' } };
          const objs = buckets[bucket] ?? [];
          const pre = prefix ? `${prefix}/` : '';
          const names = new Map();
          for (const o of objs) {
            if (!o.path.startsWith(pre)) continue;
            const rest = o.path.slice(pre.length);
            const [head, ...tail] = rest.split('/');
            if (tail.length) names.set(head, { name: head, id: null });
            else names.set(head, { name: head, id: 'x', created_at: o.createdAt, metadata: { size: o.size } });
          }
          const sorted = [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
          return { data: sorted.slice(offset, offset + limit), error: null };
        },
      };
    },
  };
  return { from, storage, calls };
}

const draftOrder = (patch = {}) => ({ id: ORDER, status: 'draft', data: {}, sticker_preview_path: '', ...patch });
const item = (patch = {}) => ({ id: ITEM, order_id: ORDER, tz_pdf_path: '', ...patch });
const print = (patch = {}) => ({ id: PRINT, item_id: ITEM, artwork_path: '', layout: null, ...patch });
const file = (name, createdAt = OLD, size = 100) => ({ path: p(name), size, createdAt });

function baseTables(patch = {}) {
  return {
    orders: [draftOrder()],
    order_items: [item()],
    order_item_prints: [print()],
    order_item_labels: [],
    order_notes_cards: [],
    order_events: [],
    ...patch,
  };
}

const paths = (r) => r.candidates.map((c) => c.path);

describe('order-artworks: носители', () => {
  it('файл без носителя старше 7 суток в черновике — кандидат', async () => {
    const db = fakeDb(baseTables(), { 'order-artworks': [file('art/x.png')] });
    const r = await orderArtworksReport(db, NOW);
    expect(paths(r)).toEqual([p('art/x.png')]);
    expect(r.bytes).toBe(100);
  });

  it('файл с носителем-колонкой — жив', async () => {
    const db = fakeDb(baseTables({ order_item_prints: [print({ artwork_path: p('art/x.pdf') })] }),
      { 'order-artworks': [file('art/x.pdf')] });
    const r = await orderArtworksReport(db, NOW);
    expect(paths(r)).toEqual([]);
    expect(r.taken).toBe(1);
  });

  it('`.preview.png` живого макета — жив', async () => {
    const db = fakeDb(baseTables({ order_item_prints: [print({ artwork_path: p('art/x.pdf') })] }),
      { 'order-artworks': [file('art/x.pdf'), file('art/x.pdf.preview.png')] });
    const r = await orderArtworksReport(db, NOW);
    expect(paths(r)).toEqual([]);
    // Превью держит колонка (производный носитель), а не только текст заказа
    expect(r.taken).toBe(2);
  });

  it('превью бирки из массива `preview_paths` — жив', async () => {
    const db = fakeDb(baseTables({
      order_item_labels: [{ id: 'l1', item_id: ITEM, attach_image_path: '', preview_paths: [p('label/a.png')] }],
    }), { 'order-artworks': [file('label/a.png')] });
    expect(paths(await orderArtworksReport(db, NOW))).toEqual([]);
  });

  it('путь только в `order_events` (текстовый носитель) — жив', async () => {
    const db = fakeDb(baseTables({
      order_events: [{ id: 1, order_id: ORDER, kind: 'status', reason: `ТЗ 1 из 3: ${p('tz/old.pdf')}` }],
    }), { 'order-artworks': [file('tz/old.pdf')] });
    expect(paths(await orderArtworksReport(db, NOW))).toEqual([]);
  });

  it('путь только в `orders.data` — жив', async () => {
    const db = fakeDb(baseTables({ orders: [draftOrder({ data: { tzHistory: [{ path: p('tz/v1.pdf') }] } })] }),
      { 'order-artworks': [file('tz/v1.pdf')] });
    expect(paths(await orderArtworksReport(db, NOW))).toEqual([]);
  });

  it('путь только в слое `layout` нанесения — жив', async () => {
    const db = fakeDb(baseTables({ order_item_prints: [print({ layout: { v: 1, extra: p('art/layer.png') } })] }),
      { 'order-artworks': [file('art/layer.png')] });
    expect(paths(await orderArtworksReport(db, NOW))).toEqual([]);
  });

  it('файл заказа не в `draft` — жив всегда', async () => {
    const db = fakeDb(baseTables({ orders: [draftOrder({ status: 'production' })] }),
      { 'order-artworks': [file('art/x.png')] });
    const r = await orderArtworksReport(db, NOW);
    expect(paths(r)).toEqual([]);
    expect(r.heldNotDraft).toBe(1);
  });

  it('строки заказа нет (удалён, статус неизвестен) — жив, считается отдельно', async () => {
    const db = fakeDb(baseTables({ orders: [], order_items: [], order_item_prints: [] }),
      { 'order-artworks': [file('art/x.png')] });
    const r = await orderArtworksReport(db, NOW);
    expect(paths(r)).toEqual([]);
    expect(r.heldNoOrder).toBe(1);
    expect(r.heldNotDraft).toBe(0);
    expect(reportNumbers({ buckets: [r] })[0].heldNoOrder).toBe(1);
  });

  it('моложе 7 суток — жив', async () => {
    const db = fakeDb(baseTables(), { 'order-artworks': [file('art/x.png', YOUNG)] });
    const r = await orderArtworksReport(db, NOW);
    expect(paths(r)).toEqual([]);
    expect(r.heldByAge).toBe(1);
  });

  it('дата создания не читается — жив (как молодой)', async () => {
    const db = fakeDb(baseTables(), { 'order-artworks': [file('art/x.png', 'не дата')] });
    expect(paths(await orderArtworksReport(db, NOW))).toEqual([]);
  });

  it('путь не вида `orders/<uuid>/…` — придержан', async () => {
    const db = fakeDb(baseTables(), { 'order-artworks': [{ path: 'stray/x.png', size: 1, createdAt: OLD }] });
    const r = await orderArtworksReport(db, NOW);
    expect(paths(r)).toEqual([]);
    expect(r.heldUnknown).toBe(1);
  });

  it('1000+ строк носителей — хвост жив (постранично)', async () => {
    const prints = Array.from({ length: PAGE + 500 }, (_, i) =>
      print({ id: `p${String(i).padStart(5, '0')}`, artwork_path: i === PAGE + 400 ? p('art/tail.pdf') : '' }));
    const db = fakeDb(baseTables({ order_item_prints: prints }), { 'order-artworks': [file('art/tail.pdf')] });
    expect(paths(await orderArtworksReport(db, NOW))).toEqual([]);
  });

  it('расхождение страниц с `count` — ошибка, кандидатов нет', async () => {
    const db = fakeDb(baseTables(), { 'order-artworks': [file('art/x.png')] },
      { lieCount: { order_item_prints: 1 } });
    await expect(orderArtworksReport(db, NOW)).rejects.toThrow(/order_item_prints/);
  });

  it('`count` поменялся между страницами — ошибка, даже если итог сошёлся', async () => {
    const prints = Array.from({ length: PAGE + 10 }, (_, i) => print({ id: `p${String(i).padStart(5, '0')}` }));
    const db = fakeDb(baseTables({ order_item_prints: prints }), { 'order-artworks': [file('art/x.png')] },
      { firstPageDrift: { order_item_prints: 1 } });
    await expect(orderArtworksReport(db, NOW)).rejects.toThrow(/изменилось/);
  });

  it('ошибка выборки носителей — ошибка, кандидатов нет', async () => {
    const db = fakeDb(baseTables(), { 'order-artworks': [file('art/x.png')] }, { fail: { order_events: true } });
    await expect(orderArtworksReport(db, NOW)).rejects.toThrow(/order_events/);
  });

  it('ошибка листинга бакета — ошибка', async () => {
    const db = fakeDb(baseTables(), { 'order-artworks': [file('art/x.png')] }, { failList: { 'order-artworks': true } });
    await expect(orderArtworksReport(db, NOW)).rejects.toThrow(/order-artworks/);
  });
});

const flat = (patch = {}) => ({ id: 'tshirt', version: 2, history: [{ version: 1, views: [] }], views: [], ...patch });
const catalog = (flats) => [{ key: 'garmentFlats', value: { version: 1, flats } }];
const flatFile = (name, createdAt = OLD) => ({ path: `flats/${name}`, size: 50, createdAt });

function flatTables(flats, prints = []) {
  return { app_config: flats === undefined ? [] : catalog(flats), order_item_prints: prints };
}

describe('garment-flats: только недописанные версии', () => {
  it('недописанная версия v(n+1) старше 7 суток — кандидат', async () => {
    const db = fakeDb(flatTables([flat()]), { 'garment-flats': [flatFile('tshirt/v3/front.svg')] });
    expect(paths(await garmentFlatsReport(db, NOW))).toEqual(['flats/tshirt/v3/front.svg']);
  });

  it('текущая версия и версия из `history` — живы', async () => {
    const db = fakeDb(flatTables([flat()]), {
      'garment-flats': [flatFile('tshirt/v2/front.svg'), flatFile('tshirt/v1/front.svg')],
    });
    expect(paths(await garmentFlatsReport(db, NOW))).toEqual([]);
  });

  it('v1 нет в истории, есть только в `layout` заказа — жива', async () => {
    const db = fakeDb(flatTables([flat({ version: 3, history: [{ version: 2, views: [] }] })]), {
      'garment-flats': [flatFile('tshirt/v1/front.svg')],
    });
    expect(paths(await garmentFlatsReport(db, NOW))).toEqual([]);
  });

  it('версия выше текущей, но её держит `layout` нанесения — жива', async () => {
    const prints = [print({ layout: { v: 1, flat_id: 'tshirt', flat_version: 3 } })];
    const db = fakeDb(flatTables([flat()], prints), { 'garment-flats': [flatFile('tshirt/v3/front.svg')] });
    expect(paths(await garmentFlatsReport(db, NOW))).toEqual([]);
  });

  it('недописанная версия моложе 7 суток — придержана', async () => {
    const db = fakeDb(flatTables([flat()]), { 'garment-flats': [flatFile('tshirt/v3/front.svg', YOUNG)] });
    const r = await garmentFlatsReport(db, NOW);
    expect(paths(r)).toEqual([]);
    expect(r.heldByAge).toBe(1);
  });

  it('флэт не найден в справочнике — ничего', async () => {
    const db = fakeDb(flatTables([flat()]), { 'garment-flats': [flatFile('hoodie/v9/front.svg')] });
    const r = await garmentFlatsReport(db, NOW);
    expect(paths(r)).toEqual([]);
    expect(r.heldUnknown).toBe(1);
  });

  it('справочника `garmentFlats` нет — ошибка, кандидатов нет', async () => {
    const db = fakeDb(flatTables(undefined), { 'garment-flats': [flatFile('tshirt/v3/front.svg')] });
    await expect(garmentFlatsReport(db, NOW)).rejects.toThrow(/garmentFlats/);
  });

  it('`garmentFlats` не разбирается — ошибка, кандидатов нет', async () => {
    const db = fakeDb({ app_config: [{ key: 'garmentFlats', value: { flats: 'не массив' } }], order_item_prints: [] },
      { 'garment-flats': [flatFile('tshirt/v3/front.svg')] });
    await expect(garmentFlatsReport(db, NOW)).rejects.toThrow(/garmentFlats/);
  });

  it('версия флэта не число — ошибка разбора', async () => {
    const db = fakeDb(flatTables([flat({ version: 'два' })]), { 'garment-flats': [flatFile('tshirt/v3/front.svg')] });
    await expect(garmentFlatsReport(db, NOW)).rejects.toThrow(/garmentFlats/);
  });
});

describe('runReport: ошибка любой выборки = пустой список кандидатов', () => {
  it('сбой носителей заказа — кандидатов нет ни в одном бакете, ok=false', async () => {
    const db = fakeDb({ ...baseTables(), ...flatTables([flat()]) }, {
      'order-artworks': [file('art/x.png')],
      'garment-flats': [flatFile('tshirt/v3/front.svg')],
    }, { fail: { order_notes_cards: true } });
    const r = await runReport(db, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/order_notes_cards/);
    expect(r.buckets).toEqual([]);
  });

  it('всё прочитано — два бакета и числа без путей', async () => {
    const db = fakeDb({ ...baseTables(), ...flatTables([flat()]) }, {
      'order-artworks': [file('art/x.png')],
      'garment-flats': [flatFile('tshirt/v3/front.svg')],
    });
    const r = await runReport(db, NOW);
    expect(r.ok).toBe(true);
    expect(r.buckets.map((b) => b.bucket)).toEqual(['order-artworks', 'garment-flats']);
    const numbers = reportNumbers(r);
    expect(JSON.stringify(numbers)).not.toMatch(/orders\/|flats\//);
    expect(numbers).toEqual([
      expect.objectContaining({ bucket: 'order-artworks', objects: 1, candidates: 1, bytes: 100 }),
      expect.objectContaining({ bucket: 'garment-flats', objects: 1, candidates: 1, bytes: 50 }),
    ]);
  });
});

describe('deleteAllowed: удаление — только `apply: true` И секрет `1`', () => {
  it.each([
    [{ apply: true }, '1', true],
    [{ apply: true }, undefined, false],
    [{ apply: true }, '', false],
    [{ apply: true }, 'true', false],
    [{ apply: true }, '0', false],
    [{}, '1', false],
    [{ apply: 'true' }, '1', false],
    [{ apply: 1 }, '1', false],
    [null, '1', false],
    [undefined, '1', false],
  ])('тело %j, секрет %j → %s', (body, secret, expected) => {
    expect(deleteAllowed(body, secret)).toBe(expected);
  });
});
