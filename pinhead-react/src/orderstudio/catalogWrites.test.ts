// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { SRC_DIR, sourceFiles, readSource } from '../testutil/sourceFiles';

/**
 * Сторож записи справочников (веха 4, задача 5).
 *
 * Справочники `app_config` / `catalog_config` пишет ОДИН клиентский модуль —
 * `orderstudio/api/catalogAdmin.ts` (RPC `catalog_put` / `prices_patch`
 * со сверкой базы: правка поверх чужой не проходит). Прямой
 * `.from('app_config').upsert(…)` писал справочник целиком поверх того, что
 * успели записать другая вкладка, другой администратор или ERP, — так
 * `SkuEditor` затирал прайс целиком, а `SkuList` — каталог моделей.
 */
const WRITER = 'orderstudio/api/catalogAdmin.ts';

const FROM = /\.from\(\s*(['"`])(app_config|catalog_config)\1\s*\)/g;
const WRITE = /\.(upsert|update|insert|delete)\s*\(/;
const RPC = /\.rpc\(\s*(['"`])(catalog_put|prices_patch)\1/;

/** Места прямой записи: цепочка после `.from('<справочник>')` до `;` или следующего `.from(` */
function directWrites(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(FROM)) {
    const start = (m.index ?? 0) + m[0].length;
    let tail = text.slice(start, start + 600);
    const cut = [tail.indexOf(';'), tail.indexOf('.from(')].filter((i) => i >= 0);
    if (cut.length) tail = tail.slice(0, Math.min(...cut));
    const w = tail.match(WRITE);
    if (w) hits.push(`${m[2]}.${w[1]}`);
  }
  return hits;
}

const files = sourceFiles().map((p) => ({ name: relative(SRC_DIR, p), text: readSource(p) }));

describe('запись справочников — только catalogAdmin.ts', () => {
  it('вне catalogAdmin.ts нет .from(app_config|catalog_config).upsert/update/insert/delete', () => {
    const bad = files
      .filter((f) => f.name !== WRITER)
      .flatMap((f) => directWrites(f.text).map((w) => `${f.name}: ${w}`));
    expect(bad).toEqual([]);
  });

  it('RPC записи справочников зовёт только catalogAdmin.ts', () => {
    const bad = files.filter((f) => f.name !== WRITER && RPC.test(f.text)).map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('писатель на месте и зовёт обе RPC', () => {
    const writer = files.find((f) => f.name === WRITER);
    expect(writer).toBeDefined();
    expect(writer!.text).toMatch(/'catalog_put'/);
    expect(writer!.text).toMatch(/'prices_patch'/);
  });

  it('самопроверка: образцы ловятся, чтение — нет', () => {
    expect(directWrites("supabase.from('app_config').upsert({ key: 'prices', value })")).toEqual(['app_config.upsert']);
    expect(directWrites("supabase\n  .from(\"catalog_config\")\n  .update({ value })\n  .eq('key', 'x')")).toEqual(['catalog_config.update']);
    expect(directWrites("db.from(`app_config`).delete().eq('key', k)")).toEqual(['app_config.delete']);
    expect(directWrites("supabase.from('app_config').insert(row)")).toEqual(['app_config.insert']);
    expect(directWrites("supabase.from('app_config').select('value').eq('key', 'prices').single();")).toEqual([]);
    // Запись в другую таблицу после чтения справочника — не его запись
    expect(directWrites("a.from('app_config').select('v'); b.from('orders').update({})")).toEqual([]);
    expect(directWrites("a.from('app_config').select('v')\n  .then(() => x.from('orders').update({}))")).toEqual([]);
    expect(RPC.test("supabase.rpc('prices_patch', { p_patch })")).toBe(true);
  });
});
