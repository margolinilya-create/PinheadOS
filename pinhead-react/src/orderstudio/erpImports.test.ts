// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join, relative, sep } from 'node:path';
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
 *
 * Примитивы и стили ERP (`erp/components/*`, `erp/erp.module.css`) разрешены
 * ЛЮБОМУ модулю Order: это общая вёрстка, а не логика ERP. Стор, утилиты и
 * экраны ERP запрещены всем, кроме моста и оболочки: стор тянет за собой весь
 * слой данных ERP и ломает бюджет чанка Order.
 */
const ORDER_DIR = join(SRC_DIR, 'orderstudio');
const ALLOWED_FILES = new Set(['bridge/tzToErpDraft.ts', 'OrderStudioApp.jsx']);
const ALLOWED_TARGETS: RegExp[] = [/\/erp\/components\/[A-Za-z]+(\.jsx)?$/, /\/erp\/erp\.module\.css$/];

/**
 * Рантайм-импорты ERP: `import X from '…/erp/…'`, `import {…} from …` и
 * side-effect `import '…/erp/…css'`. `import type` стирается при сборке и не
 * попадает в список.
 */
function runtimeErpImports(text: string): string[] {
  return [...text.matchAll(/^import\s+(?!type\b)(?:[^;]*?from\s+)?'([^']*\/erp\/[^']*)'/gm)].map((m) => m[1]);
}

/** Может ли модуль `rel` (путь от src/orderstudio, с `/`) импортировать цель `target` из ERP */
function isAllowed(rel: string, target: string): boolean {
  return ALLOWED_FILES.has(rel) || ALLOWED_TARGETS.some((re) => re.test(target));
}

describe('Order v4 не импортирует рантайм ERP', () => {
  it('сторож видит и тип, и рантайм-импорт', () => {
    expect(runtimeErpImports("import type { X } from '../../erp/types';")).toEqual([]);
    expect(runtimeErpImports("import { SIZE_PRESETS } from '../../erp/utils/orderForm';")).toEqual(['../../erp/utils/orderForm']);
  });

  it('side-effect импорт стилей ERP тоже виден сторожу', () => {
    expect(runtimeErpImports("import '../../erp/erp.module.css';")).toEqual(['../../erp/erp.module.css']);
  });

  it('примитивы и стили ERP разрешены, стор — нет', () => {
    expect(isAllowed('layout/OrderLayout.jsx', '../../erp/components/Button')).toBe(true);
    expect(isAllowed('layout/OrderLayout.jsx', '../../erp/erp.module.css')).toBe(true);
    expect(isAllowed('screens/SalesList.jsx', '../../erp/store/useErpStore')).toBe(false);
    expect(isAllowed('OrderStudioApp.jsx', '../erp/screens/AdminScreen')).toBe(true);
  });

  it('ни один модуль, кроме моста и оболочки', () => {
    const bad = sourceFiles(ORDER_DIR)
      .map((f) => {
        const rel = relative(ORDER_DIR, f).split(sep).join('/');
        return { rel, imports: runtimeErpImports(readSource(f)).filter((target) => !isAllowed(rel, target)) };
      })
      .filter((f) => f.imports.length > 0);
    expect(bad).toEqual([]);
  });
});
