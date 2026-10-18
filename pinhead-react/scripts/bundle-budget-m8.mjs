/**
 * Стражи бюджета вехи 8 («рестайл остатка и включение»), задача 0 (18.10). Подключает их
 * `scripts/bundle-budget.mjs` (там 570+ строк — отдельная тема, как `bundle-budget-5b.mjs`
 * и `bundle-budget-m67.mjs`). Решение К11 плана вехи 8: бюджеты не поднимаются.
 *
 * ТРИ ГРАФА.
 *
 * 1. «ОБОЛОЧКА ORDER» = статический граф входа + `OrderStudioApp` + `OrderWorkplace`,
 *    JS и CSS отдельно. Раньше печаталась справочно, без потолка. Задача 6 переносит
 *    `garment.css` из чанка `OrderStudioApp` в модули панелей рабочего места и тянет туда
 *    примитивы ERP — рост иначе никто не поймает. Потолок = замер задачи 0 + 2 %.
 *
 * 2. «СПРАВОЧНИК МОДЕЛЕЙ» = граф `components/editors/SkuEditor.jsx` минус оболочка Order,
 *    JS + свой CSS. 3. «ЭКСПРЕСС» = то же для `ExpressCalc.jsx`.
 *    До рестайла у редакторов своего CSS нет: их классы живут в глобальных `editors.css`
 *    и `express.css`, которые едут чанком `OrderStudioApp` (то есть в оболочке Order).
 *    Рестайл (задачи 3 и 4) удаляет глобальный файл и заводит `*.module.css` — CSS
 *    переезжает из оболочки в чанк редактора. Поэтому потолок редактора = (JS + gzip
 *    его глобального CSS) × 1,05, а оболочка Order при этом обязана похудеть, а не
 *    вырасти (потолок пункта 1). Рост сверх — разбор в задаче, а не подъём числа в T9.
 *
 * Замер задачи 0 (сборка с `VERCEL_GIT_COMMIT_SHA=000000000000base`, HEAD 3965a272):
 *   оболочка Order JS 282 993, CSS 46 874;
 *   SkuEditor JS 23 783 (SkuEditor, sameJson, zonesEdit), CSS 0; `editors.css` gzip 9 513;
 *   ExpressCalc JS 3 832, CSS 0; `express.css` gzip 1 914.
 */

/** Оболочка Order, JS: 282 993 × 1,02 */
export const ORDER_SHELL_JS_BUDGET = 288_653;
/** Оболочка Order, CSS: 46 874 × 1,02 */
export const ORDER_SHELL_CSS_BUDGET = 47_811;

/** Редакторы: (JS + gzip глобального CSS, который рестайл удалит) × 1,05 */
export const EDITOR_BUDGETS = {
  SkuEditor: { label: 'Справочник моделей', src: 'src/components/editors/SkuEditor.jsx', budget: 34_961 },
  ExpressCalc: { label: 'Экспресс', src: 'src/components/editors/ExpressCalc.jsx', budget: 6_033 },
};

const minus = (files, ...sets) => files.filter((f) => !sets.some((set) => set.includes(f)));

export function checkRestyle(ctx) {
  const { manifest, staticGraph, report, check, fail, findKey, entryKey, orderAppKey, workplaceKey } = ctx;
  const order = staticGraph(manifest, [entryKey, orderAppKey, workplaceKey].filter(Boolean));
  const orderJsTotal = report('Оболочка Order — JS (вход + OrderStudioApp + OrderWorkplace)', order.js).total;
  const orderCssTotal = report('Оболочка Order — CSS (вход + OrderStudioApp + OrderWorkplace)', order.css).total;
  check('Оболочка Order, JS', orderJsTotal, ORDER_SHELL_JS_BUDGET);
  check('Оболочка Order, CSS', orderCssTotal, ORDER_SHELL_CSS_BUDGET);

  const editors = {};
  for (const [name, { label, src, budget }] of Object.entries(EDITOR_BUDGETS)) {
    const key = findKey(name, src);
    if (!key) {
      fail(`${src} не найден в манифесте — редактор переехал или стал статическим, поправьте страж`);
      editors[name] = null;
      continue;
    }
    const graph = staticGraph(manifest, [key]);
    const files = [...minus(graph.js, order.js), ...minus(graph.css, order.css)];
    const total = report(`${label} — JS+CSS (${name} минус оболочка Order)`, files).total;
    check(`${label}, JS+CSS`, total, budget);
    editors[name] = total;
  }
  return { orderJsTotal, orderCssTotal, editors };
}
