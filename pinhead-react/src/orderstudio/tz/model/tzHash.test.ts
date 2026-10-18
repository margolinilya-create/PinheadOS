// @vitest-environment node
/**
 * Хэш ТЗ на webcrypto Node (К1): стабилен к порядку ключей, меняется от ячейки
 * сетки, НЕ меняется от даты оформления и адреса; без криптографии — отказ.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { FIXTURE_OPTS, fixtureCatalogs, loadFixture } from '../../fixtures/loadFixture.testutil';
import { artworkPath } from '../../api/artworks';
import { tzGroups } from './tzGroups';
import { tzDocument } from './tzDocument';
import type { TzDoc } from './tzDocTypes';
import {
  NO_CRYPTO_MESSAGE, TZ_HASH_EXCLUDE, TZ_LAYOUT_V, canonicalTzForHash, defaultDigest, groupHashFromTzPath,
  hashFromTzPath, tzContentHash,
} from './tzHash';
import { TZ_NAME_BASE_MAX, tzFileName } from './tzFileName';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../../store/useToastStore', () => ({ toast: { error: vi.fn() } }));

function doc67108(): TzDoc {
  const { order } = loadFixture('67108');
  return tzDocument(order, tzGroups(order)[0], fixtureCatalogs(), FIXTURE_OPTS);
}

const sha12 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

afterEach(() => vi.unstubAllGlobals());

describe('tzContentHash', () => {
  it('равен эталонному sha-256 канонического JSON (первые 12 hex)', async () => {
    const doc = doc67108();
    const h = await tzContentHash(doc);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(h).toBe(sha12(canonicalTzForHash(doc)));
    expect(sha12('{"a":1}')).toBe('015abd7f5cc5');
  });

  it('порядок ключей на хэш не влияет', async () => {
    const doc = doc67108();
    const reordered = { footer: doc.footer, typicalFlat: doc.typicalFlat, notes: doc.notes, prints: doc.prints,
      labels: doc.labels, fabric: doc.fabric, header: { ...doc.header } } as TzDoc;
    expect(await tzContentHash(reordered)).toBe(await tzContentHash(doc));
  });

  it('ячейка сетки меняет хэш', async () => {
    const doc = doc67108();
    const changed = structuredClone(doc);
    changed.fabric.grid.rows[0].cells[3] += 1;
    expect(await tzContentHash(changed)).not.toBe(await tzContentHash(doc));
  });

  it('дата оформления и адрес сборки хэш НЕ меняют', async () => {
    const { order } = loadFixture('67108');
    const g = tzGroups(order)[0];
    const a = tzDocument(order, g, fixtureCatalogs(), FIXTURE_OPTS);
    const b = tzDocument(order, g, fixtureCatalogs(), { issuedOn: '2027-03-01', appOrigin: 'http://localhost:5173' });
    expect(b.header.issuedOn).not.toBe(a.header.issuedOn);
    expect(await tzContentHash(b)).toBe(await tzContentHash(a));
    expect(TZ_HASH_EXCLUDE).toEqual(['header.issuedOn', 'footer.link']);
    expect(canonicalTzForHash(a)).toContain(`"layoutV":${TZ_LAYOUT_V}`);
  });

  it('без криптографии — отказ с текстом про https', async () => {
    await expect(tzContentHash(doc67108(), null)).rejects.toThrow(NO_CRYPTO_MESSAGE);
    expect(defaultDigest({} as Crypto)).toBeNull();
    const doc = doc67108();
    vi.stubGlobal('crypto', undefined);
    await expect(tzContentHash(doc)).rejects.toThrow(/откройте сайт по https/);
  });
});

describe('tzFileName и hashFromTzPath', () => {
  const hash12 = 'a1b2c3d4e5f6';

  it('ASCII, хэши в начале, основа ≤ 100', () => {
    const name = tzFileName({ number: 'PH-6710' }, { hash8: '0badf00d' }, doc67108(), hash12);
    expect(name).toBe('PH-6710-g0badf00d-ca1b2c3d4e5f6-Fertoing_T-shirt_Regular_01.10.2025.pdf');
    expect(name).toMatch(/^[\x21-\x7e]+$/);
    expect(name.length - '.pdf'.length).toBeLessThanOrEqual(TZ_NAME_BASE_MAX);
  });

  it('имя модели на 200 знаков: хэш достаётся из artworkPath', () => {
    const doc = doc67108();
    const long = { header: { ...doc.header, productTitle: 'Очень длинная модель '.repeat(10) } };
    const name = tzFileName({ number: 'PH-6710' }, { hash8: '0badf00d' }, long, hash12);
    expect(name.length - '.pdf'.length).toBeLessThanOrEqual(TZ_NAME_BASE_MAX);
    const path = artworkPath('6F710800-0000-4000-8000-000000067108', 'tz', name);
    expect(path).toMatch(/^orders\/6f710800-0000-4000-8000-000000067108\/tz\/[0-9a-f-]{36}-PH-6710-g0badf00d-c/);
    expect(hashFromTzPath(path)).toBe(hash12);
    expect(groupHashFromTzPath(path)).toBe('0badf00d');
  });

  it('путь без хэшей и пустой — null; номера нет — PH-draft', () => {
    expect(hashFromTzPath('orders/x/tz/abc-old.pdf')).toBeNull();
    expect(hashFromTzPath('')).toBeNull();
    expect(tzFileName({ number: '' }, { hash8: '0badf00d' }, doc67108(), hash12)).toMatch(/^PH-draft-g0badf00d-c/);
  });
});
