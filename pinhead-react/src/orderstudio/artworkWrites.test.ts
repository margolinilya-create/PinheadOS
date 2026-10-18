// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { SRC_DIR, sourceFiles, readSource } from '../testutil/sourceFiles';

/**
 * Сторож записи файлов заказа (веха 5а, проверка безопасности M3).
 *
 * Бакет `order-artworks` пишет и чистит ОДИН клиентский модуль —
 * `orderstudio/api/artworks.ts`: там проверка пути заказа (`isArtworkPath` =
 * `order_artwork_path_ok`), `upsert: false`, тип по расширению, превью PDF/AI
 * только PNG по выводимому пути `<исходник>.preview.png` и удаление превью
 * вместе с исходником. Загрузка мимо него — «превью» по произвольному ключу,
 * файл без проверки типа или осиротевшее превью после удаления исходника.
 */
const WRITER = 'orderstudio/api/artworks.ts';

/** `.from('order-artworks')` или `.from(ARTWORK_BUCKET)` и цепочка до `;` */
const FROM = /\.from\(\s*(?:(['"`])order-artworks\1|ARTWORK_BUCKET)\s*\)/g;
const WRITE_NAMES = 'upload|update|remove|move|copy|uploadToSignedUrl|createSignedUploadUrl';
const WRITE = new RegExp(`\\.(${WRITE_NAMES})\\s*\\(`);
/** Бакет назван в коде: строкой или константой писателя */
const MENTION = /(['"`])order-artworks\1|\bARTWORK_BUCKET\b/;

/** Комментарии прочь: упоминание бакета в комментарии — не обращение к нему */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Переменная с бакетом: `const b = supabase.storage.from('order-artworks');` → `b` */
function bucketAliases(text: string, m: RegExpMatchArray): string[] {
  const before = text.slice(0, m.index ?? 0);
  const stmt = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1);
  const a = /(?:\b(?:const|let|var)\s+|^\s*)([A-Za-z_$][\w$]*)\s*=(?!=)[^=]*$/.exec(stmt);
  return a ? [a[1]] : [];
}

/**
 * Записи в бакет: цепочкой от `.from(…)` до `;` и через переменную
 * (`const b = …from(ARTWORK_BUCKET); b.upload(…)` — так `signOne` писателя
 * держит бакет для подписанных ссылок; без этой ветки сторож молчал бы).
 */
function bucketWrites(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(FROM)) {
    const start = (m.index ?? 0) + m[0].length;
    let tail = text.slice(start, start + 400);
    const cut = [tail.indexOf(';'), tail.indexOf('.from(')].filter((i) => i >= 0);
    if (cut.length) tail = tail.slice(0, Math.min(...cut));
    const w = WRITE.exec(tail);
    if (w) hits.push(w[1]);
    for (const alias of bucketAliases(text, m)) {
      const re = new RegExp(`(?<![\\w$.])${alias.replace(/\$/g, '\\$')}\\s*\\.\\s*(${WRITE_NAMES})\\s*\\(`, 'g');
      for (const a of text.slice(start).matchAll(re)) hits.push(a[1]);
    }
  }
  return hits;
}

/**
 * Грубая сеть вне писателя: файл называет бакет в коде И пишет в хранилище
 * (`.upload(` и т. п.) — подозрение, даже если связь не видна регуляркой
 * (переменная, параметр функции, обёртка). Ложное срабатывание — повод
 * перенести запись в писатель, а не ослабить сторож.
 */
function mentionsAndWrites(text: string): boolean {
  const code = stripComments(text);
  return MENTION.test(code) && WRITE.test(code);
}

const files = sourceFiles().map((p) => ({ name: relative(SRC_DIR, p), text: readSource(p) }));

describe('запись в order-artworks — только api/artworks.ts', () => {
  it('вне писателя нет upload/remove/update/move/copy по бакету заказа', () => {
    const bad = files
      .filter((f) => f.name !== WRITER)
      .flatMap((f) => bucketWrites(f.text).map((w) => `${f.name}: ${w}`));
    expect(bad).toEqual([]);
  });

  it('вне писателя бакет не называется в файле, который пишет в хранилище', () => {
    expect(files.filter((f) => f.name !== WRITER && mentionsAndWrites(f.text)).map((f) => f.name)).toEqual([]);
  });

  it('писатель на месте: загрузки без upsert (макет, превью, PDF ТЗ), удаление одно', () => {
    const w = files.find((f) => f.name === WRITER);
    expect(w).toBeDefined();
    const writes = bucketWrites(w!.text);
    expect(writes.filter((x) => x === 'upload').length).toBe(3);
    expect(writes.filter((x) => x === 'remove').length).toBe(1);
    expect(writes.every((x) => x === 'upload' || x === 'remove')).toBe(true);
    expect(w!.text.match(/\.upload\([^;]*?\{\s*upsert: false/g)?.length).toBe(3);
    expect(w!.text).not.toMatch(/upsert: true/);
  });

  it('PDF ТЗ (веха 6+7) — свой писатель: вид tz, тип application/pdf, проверка сигнатуры', () => {
    const w = files.find((f) => f.name === WRITER)!.text;
    const fn = /export async function uploadTzPdf[\s\S]*?\n}\n/.exec(w)?.[0] ?? '';
    expect(fn).toMatch(/artworkPath\(orderId, 'tz', fileName\)/);
    expect(fn).toMatch(/upload\(path, body, \{ upsert: false, contentType: 'application\/pdf' \}\)/);
    expect(fn).toMatch(/PDF_SIG\.every/);
  });

  it('самопроверка: образцы ловятся, чтение — нет', () => {
    expect(bucketWrites("supabase.storage.from('order-artworks').upload(p, b)")).toEqual(['upload']);
    expect(bucketWrites('supabase.storage\n  .from(ARTWORK_BUCKET)\n  .remove([p])')).toEqual(['remove']);
    expect(bucketWrites('s.from(`order-artworks`).move(a, b)')).toEqual(['move']);
    expect(bucketWrites("s.from('order-artworks').download(p);")).toEqual([]);
    expect(bucketWrites("s.from(ARTWORK_BUCKET).download(p); t.from('garment-flats').upload(x)")).toEqual([]);
  });

  it('самопроверка: запись через переменную ловится, чтение через неё — нет', () => {
    expect(bucketWrites("const b = supabase.storage.from('order-artworks'); b.upload(p, x)")).toEqual(['upload']);
    expect(bucketWrites('let bucket = s.from(ARTWORK_BUCKET);\nawait bucket\n  .remove([p]);')).toEqual(['remove']);
    expect(bucketWrites('const bucket = s.from(ARTWORK_BUCKET);\nconst r = await bucket.createSignedUrl(p, 600);')).toEqual([]);
    // Чужая переменная с тем же хвостом имени — не путается
    expect(bucketWrites("const b = s.from('order-artworks'); b.download(p); ab.upload(x); o.b.upload(y)")).toEqual([]);
  });

  it('самопроверка грубой сети: бакет + запись в одном файле — да; только комментарий — нет', () => {
    expect(mentionsAndWrites("import { ARTWORK_BUCKET } from './api/artworks';\nconst s = storage.from(name);\ns.upload(p, x);")).toBe(true);
    expect(mentionsAndWrites("/** файлы в бакете `order-artworks` */\nel.classList.remove('x');")).toBe(false);
    expect(mentionsAndWrites("// бакет 'order-artworks'\nfoo.upload(x);")).toBe(false);
    expect(mentionsAndWrites("const b = 'order-artworks';\nconst url = 'https://x.y/z';")).toBe(false);
  });
});
