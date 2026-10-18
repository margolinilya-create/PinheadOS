// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { SRC_DIR, sourceFiles, readSource } from '../testutil/sourceFiles';

/**
 * Сторож одного писателя справочника зон нанесения (веха 5б, задача 4; К8).
 *
 * `app_config.zonesCatalog` правится только режимом «Зоны нанесения» вкладки
 * «Флэты и зоны» — `admin/flats/ZonesCatalogEditor.jsx` через
 * `useCatalogEditor('app_config', 'zonesCatalog')`. Прежний редактор `/sku`
 * жёстко удалял зоны и не проверял уникальность названий; его запись
 * (`useSkuSave`) убрана, вкладка `/sku` — только просмотр. Второй писатель
 * того же ключа — два редактора с разными правилами.
 *
 * Пишущий код узнаётся по паре «вызов записи справочника» + строковый литерал
 * `'zonesCatalog'` в одном файле: так ловится и прямой вызов, и таблица
 * справочников, которую обходит общий `putCatalog(def.table, def.key, …)`.
 */
const EDITOR = 'orderstudio/admin/flats/ZonesCatalogEditor.jsx';
/** Белый список ключей `catalog_put` — сам писатель RPC */
const WRITER = 'orderstudio/api/catalogAdmin.ts';

const ZONES_LITERAL = /(['"`])zonesCatalog\1/;
const WRITE_CALL = /\b(putCatalog|useCatalogEditor|patchPrices)\s*\(/;
const EDITOR_CALL = /useCatalogEditor\(\s*(['"`])app_config\1\s*,\s*(['"`])zonesCatalog\2\s*\)/;

const files = sourceFiles().map((p) => ({ name: relative(SRC_DIR, p), text: readSource(p) }));

describe('справочник зон — один писатель', () => {
  it('useCatalogEditor(app_config, zonesCatalog) — только в ZonesCatalogEditor.jsx', () => {
    expect(files.filter((f) => EDITOR_CALL.test(f.text)).map((f) => f.name)).toEqual([EDITOR]);
  });

  it('вызов записи справочника рядом с ключом zonesCatalog — только у редактора зон', () => {
    const bad = files
      .filter((f) => f.name !== EDITOR && f.name !== WRITER)
      .filter((f) => ZONES_LITERAL.test(f.text) && WRITE_CALL.test(f.text))
      .map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('useSkuSave.ts не знает zonesCatalog', () => {
    const f = files.find((x) => x.name === 'components/editors/sku/useSkuSave.ts');
    expect(f).toBeDefined();
    expect(f?.text).not.toMatch(/zonesCatalog/);
  });
});
