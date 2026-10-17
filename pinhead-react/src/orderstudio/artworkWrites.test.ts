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
const WRITE = /\.(upload|update|remove|move|copy|uploadToSignedUrl|createSignedUploadUrl)\s*\(/;

function bucketWrites(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(FROM)) {
    const start = (m.index ?? 0) + m[0].length;
    let tail = text.slice(start, start + 400);
    const cut = [tail.indexOf(';'), tail.indexOf('.from(')].filter((i) => i >= 0);
    if (cut.length) tail = tail.slice(0, Math.min(...cut));
    const w = WRITE.exec(tail);
    if (w) hits.push(w[1]);
  }
  return hits;
}

const files = sourceFiles().map((p) => ({ name: relative(SRC_DIR, p), text: readSource(p) }));

describe('запись в order-artworks — только api/artworks.ts', () => {
  it('вне писателя нет upload/remove/update/move/copy по бакету заказа', () => {
    const bad = files
      .filter((f) => f.name !== WRITER)
      .flatMap((f) => bucketWrites(f.text).map((w) => `${f.name}: ${w}`));
    expect(bad).toEqual([]);
  });

  it('писатель на месте: загрузки без upsert, удаление одно', () => {
    const w = files.find((f) => f.name === WRITER);
    expect(w).toBeDefined();
    const writes = bucketWrites(w!.text);
    expect(writes.filter((x) => x === 'upload').length).toBe(2);
    expect(writes.filter((x) => x === 'remove').length).toBe(1);
    expect(writes.every((x) => x === 'upload' || x === 'remove')).toBe(true);
    expect(w!.text.match(/\.upload\([^;]*?\{\s*upsert: false/g)?.length).toBe(2);
    expect(w!.text).not.toMatch(/upsert: true/);
  });

  it('самопроверка: образцы ловятся, чтение — нет', () => {
    expect(bucketWrites("supabase.storage.from('order-artworks').upload(p, b)")).toEqual(['upload']);
    expect(bucketWrites('supabase.storage\n  .from(ARTWORK_BUCKET)\n  .remove([p])')).toEqual(['remove']);
    expect(bucketWrites('s.from(`order-artworks`).move(a, b)')).toEqual(['move']);
    expect(bucketWrites("s.from('order-artworks').download(p);")).toEqual([]);
    expect(bucketWrites("s.from(ARTWORK_BUCKET).download(p); t.from('garment-flats').upload(x)")).toEqual([]);
  });
});
