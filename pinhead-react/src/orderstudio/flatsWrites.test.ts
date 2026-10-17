// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { SRC_DIR, sourceFiles, readSource } from '../testutil/sourceFiles';

/**
 * Сторож записи флэтов (веха 5а, миграция H).
 *
 * Бакет `garment-flats` пишет ОДИН клиентский модуль — `orderstudio/api/garmentFlats.ts`:
 * там проверка пути (`isFlatPath` = `garment_flat_path_ok`), `upsert: false`
 * (объект неизменяем), тип `image/svg+xml` и разбор ответа «уже есть».
 * Загрузка мимо него — флэт без проверки пути и размера; `upsert`, `move`,
 * `copy`, `update`, `remove` бакет отклонит, но человеку это видно только
 * отказом на бою. Справочник `garmentFlats` пишет `catalogAdmin.ts`
 * (сторож `catalogWrites.test.ts`).
 */
const WRITER = 'orderstudio/api/garmentFlats.ts';

/** `.from('garment-flats')` или `.from(FLATS_BUCKET)` и цепочка до `;` */
const FROM = /\.from\(\s*(?:(['"`])garment-flats\1|FLATS_BUCKET)\s*\)/g;
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

describe('запись в garment-flats — только api/garmentFlats.ts', () => {
  it('вне писателя нет upload/remove/update/move/copy по бакету флэтов', () => {
    const bad = files
      .filter((f) => f.name !== WRITER)
      .flatMap((f) => bucketWrites(f.text).map((w) => `${f.name}: ${w}`));
    expect(bad).toEqual([]);
  });

  it('имя бакета строкой — только в писателе (остальные берут FLATS_BUCKET)', () => {
    const bad = files.filter((f) => f.name !== WRITER && /['"`]garment-flats['"`]/.test(f.text)).map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('писатель на месте: upload с upsert: false, ни remove, ни upsert: true', () => {
    const w = files.find((f) => f.name === WRITER);
    expect(w).toBeDefined();
    expect(bucketWrites(w!.text)).toEqual(['upload']);
    expect(w!.text).toMatch(/upsert: false/);
    expect(w!.text).not.toMatch(/upsert: true/);
  });

  it('самопроверка: образцы ловятся, чтение — нет', () => {
    expect(bucketWrites("supabase.storage.from('garment-flats').upload(p, b)")).toEqual(['upload']);
    expect(bucketWrites('supabase.storage\n  .from(FLATS_BUCKET)\n  .remove([p])')).toEqual(['remove']);
    expect(bucketWrites('s.from(`garment-flats`).move(a, b)')).toEqual(['move']);
    expect(bucketWrites("s.from('garment-flats').download(p);")).toEqual([]);
    expect(bucketWrites("s.from('garment-flats').download(p); t.from('order-artworks').upload(x)")).toEqual([]);
  });
});
