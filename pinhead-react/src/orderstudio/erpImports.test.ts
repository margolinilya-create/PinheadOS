// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
 * Запуск в производство зовёт `createOrder` стора ERP, но пускается УЖЕ:
 * стор ERP берёт ровно один модуль Order — шлюз `bridge/erpGateway.ts`, ровно
 * пять модулей ERP списком (`GATEWAY_MODULES`), а сам шлюз грузится только
 * динамическим `import('./erpGateway')` из `bridge/launch.ts`. Статический
 * импорт шлюза или стора утянул бы слой данных ERP в чанк Order, лишний модуль —
 * ещё одну зависимость от замороженного ERP. Почему шлюз, а не три `import()`
 * модулей ERP прямо в `launch.ts` (так было до задачи 7 вехи 6+7): три новые
 * точки входа резали общий чанк оболочки ERP (+707 Б gzip) — шапка шлюза.
 *
 * Примитивы и стили ERP разрешены ЛЮБОМУ модулю Order: это общая вёрстка, а не
 * логика ERP. Примитивы — явный белый список, а не маска `erp/components/*`:
 * маска впускала компоненты, которые читают стор ERP (StaleDataBar, ErpKanban,
 * RouteEditor), и хуки (useStageReports). Стор, утилиты и экраны ERP запрещены
 * всем, кроме моста и оболочки: стор тянет за собой весь слой данных ERP и
 * ломает бюджет чанка Order.
 */

/**
 * КОРНИ СКАНИРОВАНИЯ (веха 8, задача 1, решение К3). Рестайл SkuEditor,
 * экспресса и панелей визарда идёт на месте — в `components/editors/**`
 * и `components/steps/garment/**`, вне `orderstudio/`. Эти модули грузятся
 * тем же ленивым чанком Order и получают тот же белый список: примитивы
 * и `erp/erp.module.css` — да, стор и утилиты ERP — нет.
 *
 * Пути модулей и целей — от `src` (`orderstudio/bridge/launch.ts`,
 * `components/editors/ExpressCalc.jsx`, `erp/store/useErpStore`): у модулей
 * трёх корней разная глубина, и относительный префикс `../../erp/` для них
 * разный. Цель импорта разрешается `path.resolve` от каталога модуля, а не
 * регэкспом префикса: `../../../erp/…` из `steps/garment` и `/src/erp/…`
 * (адрес от корня проекта, Vite его понимает) — та же цель.
 */
const ROOTS: ReadonlyArray<{ dir: string; label: string }> = [
  { dir: join(SRC_DIR, 'orderstudio'), label: 'Order v4' },
  { dir: join(SRC_DIR, 'components', 'editors'), label: 'редакторы (SkuEditor, экспресс)' },
  { dir: join(SRC_DIR, 'components', 'steps', 'garment'), label: 'панели визарда' },
];
const ERP_DIR = join(SRC_DIR, 'erp');
const COMPONENTS_DIR = join(ERP_DIR, 'components');
const ALLOWED_FILES = new Set(['orderstudio/bridge/tzToErpDraft.ts', 'orderstudio/OrderStudioApp.jsx']);

/** Шлюз запуска: единственный модуль Order со стором ERP — и только эти модули ERP */
const GATEWAY = 'orderstudio/bridge/erpGateway.ts';
const GATEWAY_MODULES: ReadonlySet<string> = new Set([
  'erp/lazyScreen',
  'erp/store/useErpStore',
  'erp/screens/orders/create/orderPayload',
  'erp/utils/garmentSource',
  'erp/utils/statusUi',
]);
/** Кто и как грузит шлюз: только `launch.ts`, только `import()` */
const GATEWAY_IMPORTERS: Record<string, string> = { 'orderstudio/bridge/launch.ts': './erpGateway' };

/** Верхний уровень erp/components, которым разрешено импортироваться из Order (проверено: сами не тянут стор/supabase/api) */
const ERP_PRIMITIVES = new Set([
  'Button', 'Icon', 'icons', 'Badge', 'Field', 'Modal', 'Drawer', 'Tabs', 'PageHead', 'ErpStates',
  'Pagination', 'FilterBar', 'FilterChip', 'DateField', 'SearchInput', 'SortableTh', 'ScrollHintBox', 'ErpSkeletons',
]);

/** Цель `erp/components/<Name>[.js|.jsx]` с Name из белого списка либо `erp/erp.module.css` (пути от src) */
const PRIMITIVE_TARGET = /^erp\/components\/([A-Za-z]+)(?:\.jsx?)?$/;
const ERP_STYLES_TARGET = /^erp\/erp\.module\.css$/;

/**
 * Рантайм-импорты, все три формы:
 * - `import X from '…'`, `import {…} from …`, side-effect `import '…css'`;
 * - реэкспорт `export {…} from '…'` / `export * from …`;
 * - динамический `import('…')`.
 * `import type` и `export type` стираются при сборке и не попадают в список.
 */
// Кавычки любые, но парные (`(['"])…\1`): класс только с `'` пропускал
// `import … from "…/erp/…"` — сторож обходился сменой кавычек.
const STATIC_IMPORT = /^import\s+(?!type\b)(?:[^;]*?from\s+)?(['"])([^'"]+)\1/gm;
const REEXPORT = /^export\s+(?!type\b)[^;]*?from\s+(['"])([^'"]+)\1/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;

/** Путь с `/` от src */
function fromSrc(abs: string): string {
  return relative(SRC_DIR, abs).split(sep).join('/');
}

/**
 * Цель импорта `spec` из модуля `rel` — путь от src, если она внутри `src/erp`,
 * иначе `null` (пакеты, свои модули Order). Относительный путь — от каталога
 * модуля, `/…` — от корня проекта (так его разрешает Vite).
 */
function erpTarget(rel: string, spec: string): string | null {
  let abs: string;
  if (spec.startsWith('.')) abs = resolve(SRC_DIR, dirname(rel), spec);
  else if (spec.startsWith('/')) abs = resolve(process.cwd(), `.${spec}`);
  else return null;
  const target = fromSrc(abs);
  return target === 'erp' || target.startsWith('erp/') ? target : null;
}

/** Рантайм-импорты ERP модуля `rel` — цели путями от src */
function runtimeErpImports(rel: string, text: string): string[] {
  return [STATIC_IMPORT, REEXPORT, DYNAMIC_IMPORT]
    .flatMap((re) => [...text.matchAll(re)].map((m) => erpTarget(rel, m[2])))
    .filter((t): t is string => t !== null);
}

/** Может ли модуль `rel` (путь от src, с `/`) импортировать цель `target` (путь от src) из ERP */
function isAllowed(rel: string, target: string): boolean {
  if (ALLOWED_FILES.has(rel)) return true;
  if (ERP_STYLES_TARGET.test(target)) return true;
  const primitive = PRIMITIVE_TARGET.exec(target);
  return primitive !== null && ERP_PRIMITIVES.has(primitive[1]);
}

/** Недопустимые рантайм-импорты ERP модуля `rel`; шлюзу — ровно его список */
function violations(rel: string, text: string): string[] {
  const targets = runtimeErpImports(rel, text);
  if (rel === GATEWAY) return targets.filter((target) => !GATEWAY_MODULES.has(target) && !isAllowed(rel, target));
  return targets.filter((target) => !isAllowed(rel, target));
}

/** Импорты шлюза модулем `rel`: статические (запрещены всем) и динамические */
const GATEWAY_STATIC = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+(['"])([^'"]*erpGateway)\1/gm;
const GATEWAY_DYNAMIC = /\bimport\(\s*(['"])([^'"]*erpGateway)\1\s*\)/g;
function gatewayImports(text: string): { static: string[]; dynamic: string[] } {
  return {
    static: [...text.matchAll(GATEWAY_STATIC)].map((m) => m[2]),
    dynamic: [...text.matchAll(GATEWAY_DYNAMIC)].map((m) => m[2]),
  };
}

/** Модули всех корней: путь от src и текст */
function scanned(): { rel: string; text: string; label: string }[] {
  return ROOTS.flatMap(({ dir, label }) => sourceFiles(dir).map((f) => ({ rel: fromSrc(f), text: readSource(f), label })));
}

const EXPRESS = 'components/editors/ExpressCalc.jsx';
const COLOR_PICKER = 'components/steps/garment/ColorPicker.jsx';

describe('Order v4 не импортирует рантайм ERP', () => {
  it('сторож видит и тип, и рантайм-импорт, и реэкспорт, и динамический импорт', () => {
    const r = 'orderstudio/screens/PrintRow.jsx';
    expect(runtimeErpImports(r, "import type { X } from '../../erp/types';")).toEqual([]);
    expect(runtimeErpImports(r, "import { SIZE_PRESETS } from '../../erp/utils/orderForm';")).toEqual(['erp/utils/orderForm']);
    expect(runtimeErpImports(r, "import '../../erp/erp.module.css';")).toEqual(['erp/erp.module.css']);
    expect(runtimeErpImports(r, "export { SIZE_PRESETS } from '../../erp/utils/orderForm';")).toEqual(['erp/utils/orderForm']);
    expect(runtimeErpImports(r, "export * from '../../erp/utils/orderForm';")).toEqual(['erp/utils/orderForm']);
    expect(runtimeErpImports(r, "export type { X } from '../../erp/types';")).toEqual([]);
    expect(runtimeErpImports('orderstudio/OrderStudioApp.jsx', "const S = lazy(() => import('../erp/screens/AdminScreen'));"))
      .toEqual(['erp/screens/AdminScreen']);
    // Двойные кавычки — та же форма: иначе сторож обходится сменой кавычек
    expect(runtimeErpImports(r, 'import { useErpStore } from "../../erp/store/useErpStore";')).toEqual(['erp/store/useErpStore']);
    expect(runtimeErpImports(r, 'export * from "../../erp/utils/orderForm";')).toEqual(['erp/utils/orderForm']);
    expect(runtimeErpImports('orderstudio/OrderStudioApp.jsx', 'const S = lazy(() => import("../erp/screens/AdminScreen"));'))
      .toEqual(['erp/screens/AdminScreen']);
    // пакеты и свои модули — не ERP; путь от корня проекта — ERP
    expect(runtimeErpImports(r, "import { create } from 'zustand';\nimport { x } from '../model/types';")).toEqual([]);
    expect(runtimeErpImports(r, "import { useErpStore } from '/src/erp/store/useErpStore';")).toEqual(['erp/store/useErpStore']);
  });

  it('цель разрешается от каталога модуля, а не по префиксу', () => {
    expect(erpTarget(EXPRESS, '../../erp/store/useErpStore')).toBe('erp/store/useErpStore');
    expect(erpTarget(COLOR_PICKER, '../../../erp/store/useErpStore')).toBe('erp/store/useErpStore');
    // `../../erp/…` из steps/garment уводит в `src/components/erp` — это не ERP
    expect(erpTarget(COLOR_PICKER, '../../erp/store/useErpStore')).toBeNull();
    // окольный путь в ERP — всё равно ERP
    expect(erpTarget(EXPRESS, './sku/../../../erp/utils/orderForm')).toBe('erp/utils/orderForm');
    expect(erpTarget(EXPRESS, '../../erp')).toBe('erp');
  });

  it('примитивы и стили ERP разрешены, стор — нет', () => {
    expect(isAllowed('orderstudio/layout/OrderLayout.jsx', 'erp/components/Button')).toBe(true);
    expect(isAllowed('orderstudio/layout/OrderLayout.jsx', 'erp/erp.module.css')).toBe(true);
    expect(isAllowed('orderstudio/screens/SalesList.jsx', 'erp/store/useErpStore')).toBe(false);
    expect(isAllowed('orderstudio/OrderStudioApp.jsx', 'erp/screens/AdminScreen')).toBe(true);
    // разрешение оболочки — по полному пути: одноимённый файл в другом корне его не получает
    expect(isAllowed('components/editors/OrderStudioApp.jsx', 'erp/screens/AdminScreen')).toBe(false);
  });

  it('компоненты ERP вне белого списка и хуки запрещены', () => {
    expect(isAllowed('x.jsx', 'erp/components/StaleDataBar')).toBe(false);
    expect(isAllowed('x.jsx', 'erp/components/useStageReports')).toBe(false);
    expect(isAllowed('x.jsx', 'erp/components/kanban/KanbanCard')).toBe(false);
    expect(isAllowed('x.jsx', 'erp/components/Button')).toBe(true);
  });

  it('редакторы и панели визарда: стор ERP запрещён во всех трёх формах, примитивы — нет', () => {
    const cases: [string, string][] = [[EXPRESS, '../../erp'], [COLOR_PICKER, '../../../erp']];
    for (const [rel, erp] of cases) {
      expect(violations(rel, `import { useErpStore } from '${erp}/store/useErpStore';`), rel).toEqual(['erp/store/useErpStore']);
      expect(violations(rel, `export { useErpStore } from '${erp}/store/useErpStore';`), rel).toEqual(['erp/store/useErpStore']);
      expect(violations(rel, `const m = await import('${erp}/store/useErpStore');`), rel).toEqual(['erp/store/useErpStore']);
      expect(violations(rel, `import { Button } from '${erp}/components/Button';\nimport s from '${erp}/erp.module.css';`), rel)
        .toEqual([]);
    }
  });

  it('корни сканирования не пусты и видят редакторы и панели', () => {
    const rels = new Set(scanned().map((m) => m.rel));
    for (const { dir, label } of ROOTS) expect(sourceFiles(dir).length, label).toBeGreaterThan(3);
    for (const rel of [EXPRESS, COLOR_PICKER, 'components/editors/SkuEditor.jsx', 'orderstudio/bridge/launch.ts']) {
      expect(rels.has(rel), rel).toBe(true);
    }
  });

  it('примитивы из белого списка сами не тянут стор ERP', () => {
    for (const name of ERP_PRIMITIVES) {
      const file = [`${name}.jsx`, `${name}.js`].map((e) => join(COMPONENTS_DIR, e)).find((p) => existsSync(p));
      expect(file, `нет файла для ${name}`).toBeDefined();
      const specifiers = [...readSource(file!).matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)].map((m) => m[2]);
      expect(specifiers.filter((s) => /\/store\/|lib\/supabase|lib\/api/.test(s)), name).toEqual([]);
    }
  });

  it('запуск в производство: стор ERP — только шлюз, ровно его пять модулей', () => {
    const imp = (target: string) => `import { x } from '${target}';`;
    for (const m of GATEWAY_MODULES) expect(violations(GATEWAY, imp(`../../${m}`))).toEqual([]);
    // шестой модуль ERP — нарушение и для шлюза
    expect(violations(GATEWAY, imp('../../erp/store/domainSlices'))).toEqual(['erp/store/domainSlices']);
    // типы стираются при сборке и разрешены
    expect(violations(GATEWAY, "import type { NewOrderInput } from '../../erp/store/types';")).toEqual([]);
    // разрешение личное: launch.ts и прочим стор ERP запрещён, и динамически тоже
    expect(violations('orderstudio/bridge/launch.ts', "const m = await import('../../erp/store/useErpStore');"))
      .toEqual(['erp/store/useErpStore']);
    expect(violations('orderstudio/screens/SalesCard.jsx', imp('../../erp/store/useErpStore'))).toEqual(['erp/store/useErpStore']);
  });

  it('список модулей шлюза не устарел: erpGateway.ts берёт ровно их', () => {
    const got = runtimeErpImports(GATEWAY, readSource(join(SRC_DIR, GATEWAY))).sort();
    expect(got).toEqual([...GATEWAY_MODULES].sort());
  });

  it('шлюз грузит только launch.ts и только import(): статических импортёров нет', () => {
    expect(gatewayImports("import { loadErpForLaunch } from './erpGateway';").static).toEqual(['./erpGateway']);
    expect(gatewayImports("export * from './erpGateway';").static).toEqual(['./erpGateway']);
    expect(gatewayImports("import type { ErpLaunchModules } from './erpGateway';").static).toEqual([]);
    expect(gatewayImports("const g = await import('./erpGateway');").dynamic).toEqual(['./erpGateway']);

    const found: Record<string, string> = {};
    const bad: string[] = [];
    for (const { rel, text } of scanned()) {
      const g = gatewayImports(text);
      bad.push(...g.static.map((t) => `${rel}: статический ${t}`));
      for (const t of g.dynamic) {
        if (GATEWAY_IMPORTERS[rel] === t) found[rel] = t;
        else bad.push(`${rel}: import(${t})`);
      }
    }
    expect(bad).toEqual([]);
    expect(found).toEqual(GATEWAY_IMPORTERS);
  });

  it('ни один модуль трёх корней, кроме моста и оболочки', () => {
    const bad = scanned()
      .map(({ rel, text, label }) => ({ rel, label, imports: violations(rel, text) }))
      .filter((f) => f.imports.length > 0);
    expect(bad).toEqual([]);
  });
});
