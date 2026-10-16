// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
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
 * Примитивы и стили ERP разрешены ЛЮБОМУ модулю Order: это общая вёрстка, а не
 * логика ERP. Примитивы — явный белый список, а не маска `erp/components/*`:
 * маска впускала компоненты, которые читают стор ERP (StaleDataBar, ErpKanban,
 * RouteEditor), и хуки (useStageReports). Стор, утилиты и экраны ERP запрещены
 * всем, кроме моста и оболочки: стор тянет за собой весь слой данных ERP и
 * ломает бюджет чанка Order.
 */
const ORDER_DIR = join(SRC_DIR, 'orderstudio');
const COMPONENTS_DIR = join(SRC_DIR, 'erp', 'components');
const ALLOWED_FILES = new Set(['bridge/tzToErpDraft.ts', 'OrderStudioApp.jsx']);

/** Верхний уровень erp/components, которым разрешено импортироваться из Order (проверено: сами не тянут стор/supabase/api) */
const ERP_PRIMITIVES = new Set([
  'Button', 'Icon', 'icons', 'Badge', 'Field', 'Modal', 'Drawer', 'Tabs', 'PageHead', 'ErpStates',
  'Pagination', 'FilterBar', 'FilterChip', 'DateField', 'SearchInput', 'SortableTh', 'ScrollHintBox', 'ErpSkeletons',
]);

/** Цель `…/erp/components/<Name>[.js|.jsx]` с Name из белого списка либо `…/erp/erp.module.css` */
const PRIMITIVE_TARGET = /\/erp\/components\/([A-Za-z]+)(?:\.jsx?)?$/;
const ERP_STYLES_TARGET = /\/erp\/erp\.module\.css$/;

/**
 * Рантайм-импорты ERP, все три формы:
 * - `import X from '…/erp/…'`, `import {…} from …`, side-effect `import '…/erp/…css'`;
 * - реэкспорт `export {…} from '…/erp/…'` / `export * from …`;
 * - динамический `import('…/erp/…')`.
 * `import type` и `export type` стираются при сборке и не попадают в список.
 */
// Кавычки любые, но парные (`(['"])…\1`): класс только с `'` пропускал
// `import … from "…/erp/…"` — сторож обходился сменой кавычек.
const STATIC_IMPORT = /^import\s+(?!type\b)(?:[^;]*?from\s+)?(['"])([^'"]*\/erp\/[^'"]*)\1/gm;
const REEXPORT = /^export\s+(?!type\b)[^;]*?from\s+(['"])([^'"]*\/erp\/[^'"]*)\1/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*(['"])([^'"]*\/erp\/[^'"]*)\1\s*\)/g;

function runtimeErpImports(text: string): string[] {
  return [STATIC_IMPORT, REEXPORT, DYNAMIC_IMPORT].flatMap((re) => [...text.matchAll(re)].map((m) => m[2]));
}

/** Может ли модуль `rel` (путь от src/orderstudio, с `/`) импортировать цель `target` из ERP */
function isAllowed(rel: string, target: string): boolean {
  if (ALLOWED_FILES.has(rel)) return true;
  if (ERP_STYLES_TARGET.test(target)) return true;
  const primitive = PRIMITIVE_TARGET.exec(target);
  return primitive !== null && ERP_PRIMITIVES.has(primitive[1]);
}

describe('Order v4 не импортирует рантайм ERP', () => {
  it('сторож видит и тип, и рантайм-импорт, и реэкспорт, и динамический импорт', () => {
    expect(runtimeErpImports("import type { X } from '../../erp/types';")).toEqual([]);
    expect(runtimeErpImports("import { SIZE_PRESETS } from '../../erp/utils/orderForm';")).toEqual(['../../erp/utils/orderForm']);
    expect(runtimeErpImports("import '../../erp/erp.module.css';")).toEqual(['../../erp/erp.module.css']);
    expect(runtimeErpImports("export { SIZE_PRESETS } from '../../erp/utils/orderForm';")).toEqual(['../../erp/utils/orderForm']);
    expect(runtimeErpImports("export * from '../../erp/utils/orderForm';")).toEqual(['../../erp/utils/orderForm']);
    expect(runtimeErpImports("export type { X } from '../../erp/types';")).toEqual([]);
    expect(runtimeErpImports("const S = lazy(() => import('../erp/screens/AdminScreen'));")).toEqual(['../erp/screens/AdminScreen']);
    // Двойные кавычки — та же форма: иначе сторож обходится сменой кавычек
    expect(runtimeErpImports('import { useErpStore } from "../../erp/store/useErpStore";')).toEqual(['../../erp/store/useErpStore']);
    expect(runtimeErpImports('export * from "../../erp/utils/orderForm";')).toEqual(['../../erp/utils/orderForm']);
    expect(runtimeErpImports('const S = lazy(() => import("../erp/screens/AdminScreen"));')).toEqual(['../erp/screens/AdminScreen']);
  });

  it('примитивы и стили ERP разрешены, стор — нет', () => {
    expect(isAllowed('layout/OrderLayout.jsx', '../../erp/components/Button')).toBe(true);
    expect(isAllowed('layout/OrderLayout.jsx', '../../erp/erp.module.css')).toBe(true);
    expect(isAllowed('screens/SalesList.jsx', '../../erp/store/useErpStore')).toBe(false);
    expect(isAllowed('OrderStudioApp.jsx', '../erp/screens/AdminScreen')).toBe(true);
  });

  it('компоненты ERP вне белого списка и хуки запрещены', () => {
    expect(isAllowed('x.jsx', '../../erp/components/StaleDataBar')).toBe(false);
    expect(isAllowed('x.jsx', '../../erp/components/useStageReports')).toBe(false);
    expect(isAllowed('x.jsx', '../../erp/components/kanban/KanbanCard')).toBe(false);
    expect(isAllowed('x.jsx', '../../erp/components/Button')).toBe(true);
  });

  it('примитивы из белого списка сами не тянут стор ERP', () => {
    for (const name of ERP_PRIMITIVES) {
      const file = [`${name}.jsx`, `${name}.js`].map((e) => join(COMPONENTS_DIR, e)).find((p) => existsSync(p));
      expect(file, `нет файла для ${name}`).toBeDefined();
      const specifiers = [...readSource(file!).matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)].map((m) => m[2]);
      expect(specifiers.filter((s) => /\/store\/|lib\/supabase|lib\/api/.test(s)), name).toEqual([]);
    }
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
