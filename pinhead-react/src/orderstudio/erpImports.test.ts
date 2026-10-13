// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../testutil/sourceFiles';

/**
 * Экраны и слой данных Order v4 не тянут РАНТАЙМ-код ERP.
 *
 * Не из принципа: общий модуль, который импортируют и оболочка ERP, и ленивый
 * чанк Order, сборщик выносит в отдельный чанк критического пути ERP. Замер
 * 28.09: импорт `SIZE_PRESETS` из формы ERP в редактор сетки вынес
 * `garmentSource` отдельным чанком — +250 Б gzip к оболочке, стоящей на 99 %
 * бюджета. Типы (`import type`) стираются при сборке и разрешены.
 *
 * Исключения — места, где связь с ERP и есть назначение модуля:
 * мост в ERP (`bridge/tzToErpDraft.ts`) и оболочка раздела с единой админкой.
 */
const ORDER_DIR = join(SRC_DIR, 'orderstudio');
const ALLOWED = new Set(['bridge/tzToErpDraft.ts', 'OrderStudioApp.jsx']);

function runtimeErpImports(text: string): string[] {
  return [...text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']*\/erp\/[^']*)'/gm)].map((m) => m[1]);
}

describe('Order v4 не импортирует рантайм ERP', () => {
  it('сторож видит и тип, и рантайм-импорт', () => {
    expect(runtimeErpImports("import type { X } from '../../erp/types';")).toEqual([]);
    expect(runtimeErpImports("import { SIZE_PRESETS } from '../../erp/utils/orderForm';")).toEqual(['../../erp/utils/orderForm']);
  });

  it('ни один модуль, кроме моста и оболочки', () => {
    const bad = sourceFiles(ORDER_DIR)
      .map((f) => ({ rel: relative(ORDER_DIR, f), imports: runtimeErpImports(readSource(f)) }))
      .filter((f) => f.imports.length > 0 && !ALLOWED.has(f.rel));
    expect(bad).toEqual([]);
  });
});
