#!/usr/bin/env node
/**
 * Бюджет критического пути.
 *
 * Что считаем и почему именно так. Прежний страж (инлайн в ci.yml) брал файлы,
 * перечисленные в `dist/index.html`, — это вход и его modulepreload. Но оболочка
 * ERP грузится ДИНАМИЧЕСКИ (`React.lazy(() => import('./erp/ErpApp'))`), и в HTML
 * её нет: ErpApp, общий чанк примитивов и их CSS проходили мимо счётчика.
 * Страж показывал 207 кБ там, где человек скачивал 280 — и «бюджет выполнен»
 * означало лишь, что мы не смотрим в нужную сторону.
 *
 * Здесь два числа:
 *   · «Вход» — статический граф точки входа (то, что было раньше);
 *   · «Оболочка ERP» — вход ПЛЮС статический граф ErpApp. Это честная стоимость
 *     первой отрисовки для 100% пользователей: ERP — раздел по умолчанию
 *     (`FEATURES.orderStudio` выключен), другого пути в приложение нет.
 *
 * Ленивые экраны (карточка заказа, канбан, склад…) сюда не входят намеренно:
 * они и не должны грузиться на старте, а их размер сторожит порог одного чанка.
 *
 * Запуск: npm run bundle:budget (после npm run build).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createBaseline, checkFlatsAdmin } from './bundle-budget-5b.mjs';
import { checkTzLaunch } from './bundle-budget-m67.mjs';
import { checkNoDevProfiles, checkRestyle } from './bundle-budget-m8.mjs';
import { BUDGETS } from './bundle-budget-limits.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MANIFEST = join(DIST, '.vite', 'manifest.json');

/** Вендоры вкладки «Дизайн» (веха 5а) — им нечего делать ни в одной оболочке */
const DESIGN_VENDORS = ['vendor-konva', 'vendor-pdf', 'vendor-pdfjs'];

/** Чанки, которым нечего делать в критическом пути ни при каких обстоятельствах */
const FORBIDDEN_IN_SHELL = [
  // chart.js однажды уже уехал в оболочку: `react/jsx-runtime` не был перечислен
  // в vendor-react, и Rollup приклеил его к первой группе, которая его затребовала.
  // 63 кБ gzip на каждой загрузке — в разделе, где нет ни одного графика.
  'vendor-charts',
  // Order Studio за флагом: если он попал в статический граф — флаг перестал работать
  'OrderStudioApp',
  // Холст, PDF-движок и pdfjs вехи 5а — только ленивыми чанками вкладки «Дизайн»
  // (группы задаёт manualChunks в vite.config.js)
  ...DESIGN_VENDORS,
];

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exitCode = 1;
}

function gzipSize(relPath) {
  const abs = join(DIST, relPath);
  if (!existsSync(abs)) throw new Error(`нет файла ${relPath} — сборка неполная?`);
  return gzipSync(readFileSync(abs)).length;
}

/**
 * Статический граф от набора корней: идём по `imports` (СТАТИЧЕСКИЕ импорты).
 * `dynamicImports` не разворачиваем — это и есть граница ленивой загрузки.
 */
function staticGraph(manifest, rootKeys) {
  const seen = new Set();
  const js = new Set();
  const css = new Set();
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    if (chunk.file) js.add(chunk.file);
    for (const f of chunk.css ?? []) css.add(f);
    for (const imp of chunk.imports ?? []) walk(imp);
  };
  for (const key of rootKeys) walk(key);
  return { js: [...js], css: [...css] };
}

function report(title, files) {
  let total = 0;
  const rows = files.map((f) => {
    const size = gzipSize(f);
    total += size;
    return { f, size };
  });
  rows.sort((a, b) => b.size - a.size);
  console.log(`\n${title}`);
  for (const { f, size } of rows) {
    console.log(`  ${f.padEnd(44)} ${String(size).padStart(8)} Б gzip`);
  }
  console.log(`  ${'ИТОГО'.padEnd(44)} ${String(total).padStart(8)} Б gzip`);
  return { total, rows };
}

function check(label, actual, budget) {
  const pct = Math.round((actual / budget) * 100);
  if (actual > budget) {
    fail(`${label}: ${actual} Б gzip при бюджете ${budget} (${pct}%)`);
    return false;
  }
  console.log(`✓ ${label}: ${actual} Б gzip из ${budget} (${pct}%)`);
  return true;
}

// ── main ─────────────────────────────────────────────────────────────────────

if (!existsSync(MANIFEST)) {
  console.error(`Нет ${MANIFEST}. Сначала: npm run build`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) {
  console.error('В манифесте нет точки входа — сборка сломана');
  process.exit(1);
}

/**
 * Оболочка по умолчанию. Динамические чанки Vite кладёт в манифест под ключом
 * `_<имя файла>` и настоящее имя держит в поле `name` — поэтому ищем по нему,
 * а не по пути. Хардкодить нельзя: файл переименуют, страж молча посчитает
 * «оболочка весит 0» и будет вечно зелёным — худший исход для стража.
 */
const shellKey = Object.keys(manifest).find(
  (k) => manifest[k].name === 'ErpApp' || k.endsWith('src/erp/ErpApp.jsx'),
);
if (!shellKey) {
  console.error('В манифесте нет src/erp/ErpApp.jsx — оболочка ERP переехала, поправьте страж');
  process.exit(1);
}

const entry = staticGraph(manifest, [entryKey]);
const shell = staticGraph(manifest, [entryKey, shellKey]);

const entryJs = report('Вход (index.html + modulepreload)', entry.js);
const shellJs = report('Оболочка ERP — JS (вход + ErpApp)', shell.js);
const shellCss = report('Оболочка ERP — CSS', shell.css);

console.log('');
check('Вход, JS', entryJs.total, BUDGETS.entryJs);
check('Оболочка ERP, JS', shellJs.total, BUDGETS.shellJs);
check('Оболочка ERP, CSS', shellCss.total, BUDGETS.shellCss);

// Веха 5б: вход и оболочка ERP — против базы, побайтно без сжатия (scripts/bundle-budget-5b.mjs)
const baseline = createBaseline({ root: ROOT, dist: DIST, fail, write: process.argv.includes('--write-baseline') });
baseline.strict('entryJs', 'Вход, JS', entry.js);
baseline.strict('shellJs', 'Оболочка ERP, JS', shell.js);
baseline.strict('shellCss', 'Оболочка ERP, CSS', shell.css);

for (const { f, size } of [...shellJs.rows, ...shellCss.rows]) {
  if (size > BUDGETS.singleChunk) {
    fail(`чанк ${f} — ${size} Б gzip при пороге ${BUDGETS.singleChunk} на один чанк`);
  }
}

for (const name of FORBIDDEN_IN_SHELL) {
  const hit = [...shell.js, ...shell.css].find((f) => f.includes(name));
  if (hit) fail(`${name} попал в оболочку (${hit}) — проверьте manualChunks в vite.config.js`);
}

/**
 * Виджет обратной связи (agentation.com) обязан оставаться ЛЕНИВЫМ.
 *
 * С 03.09 он работает и в проде (решение владельца), то есть в сборке
 * присутствует законно — прежняя проверка «его нет вовсе» здесь больше
 * не годится. Сторожить надо другое и более важное: он не имеет права
 * оказаться в КРИТИЧЕСКОМ ПУТИ. Пока это отдельный чанк, его скачивает
 * только тот, кому виджет показан (admin/director), и уже после первой
 * отрисовки; статический импорт вместо ленивого заставил бы платить
 * за него КАЖДОГО, включая рабочего с цеховым планшетом, который открывает
 * только свою очередь.
 *
 * ПОЧЕМУ ПО ФАЙЛАМ, А НЕ ПО МАНИФЕСТУ. Ленивый импорт даёт отдельную запись,
 * и её было бы видно; а вот СТАТИЧЕСКИЙ Rollup вклеивает в чанк импортёра,
 * не заводя записи вообще — то есть проверка по манифесту пропустила бы
 * ровно тот случай, который дороже всего. Проверено мутацией: со снятым
 * ленивым импортом код виджета уехал во ВХОДНОЙ чанк, и страж это поймал.
 * `data-agentation-root` — атрибут, которым виджет метит собственный корень
 * (по нему он исключает себя из попадания курсора), то есть строковый
 * литерал, переживающий минификацию.
 */
const DEV_TOOL_MARKER = 'data-agentation-root';
const inShell = shell.js.filter(
  (f) => existsSync(join(DIST, f)) && readFileSync(join(DIST, f), 'utf8').includes(DEV_TOOL_MARKER),
);
if (inShell.length) {
  fail(
    `виджет agentation попал в критический путь (${inShell.join(', ')}) — `
    + 'он обязан приезжать ленивым чанком, см. components/shared/DevAnnotations.jsx',
  );
} else {
  console.log('✓ виджет agentation остаётся ленивым — в критический путь не попал');
}

// ── Вкладка «Дизайн» (веха 5а) ──────────────────────────────────────────────

/** Ключ модуля в манифесте: по пути исходника или по `name` (как у ErpApp выше) */
function findKey(name, srcPath) {
  return Object.keys(manifest).find((k) => k === srcPath || manifest[k].name === name);
}

/**
 * Модуль дизайна, который обязан быть в манифесте, если его исходник существует.
 * Пока исходника нет (задачи 3–7 ещё не слиты), проверка честно говорит «пропущено»,
 * а не «0 Б»: «оболочка весит 0» — худший исход для стража. Задача 8 включает
 * `DESIGN_REQUIRED`, и тогда отсутствие любого модуля — красный страж.
 *
 * `waitsFor` — исходник, через который модуль попадает в приложение. Пока его
 * нет, модуль ещё никто не подключил (`loadPdf` грузит `useAddArtwork`, а его —
 * вкладка «Дизайн», задача 6; `exportPdf` грузит кнопка «Скачать PDF макета»,
 * а её монтирует та же вкладка): «⧗ ещё не подключён», а не красный, — ветка
 * зелёная между слияниями задач 5–7 и 6. Появился `waitsFor`, а модуля в манифесте
 * нет — красный, как и без `waitsFor`.
 */
/*
 * ЗАДАЧА 8 (18.10): все модули вехи 5а слиты — `DESIGN_REQUIRED = true`. Теперь
 * пропавший из манифеста модуль дизайна (переименовали, вклеили статически) — красный,
 * а не «⧗ пропущено»: зелёный страж на исчезнувшем модуле хуже отсутствия стража.
 */
const DESIGN_REQUIRED = true;
function designKey(name, srcPath, waitsFor = null) {
  const key = findKey(name, srcPath);
  if (key) return key;
  const exists = existsSync(join(ROOT, srcPath));
  const notWired = exists && waitsFor && !existsSync(join(ROOT, waitsFor));
  if (DESIGN_REQUIRED || (exists && !notWired)) {
    fail(`${srcPath} есть в исходниках, но не найден в манифесте — проверьте страж`);
  } else if (notWired) {
    console.log(`⧗ ${srcPath} ещё не подключён (нет ${waitsFor}) — проверка пропущена`);
  } else {
    console.log(`⧗ ${srcPath} ещё нет — проверка пропущена`);
  }
  return null;
}

const minus = (files, ...sets) => files.filter((f) => !sets.some((set) => set.includes(f)));

/**
 * ОБОЛОЧКА ORDER — вход + статический граф раздела ТЗ и рабочего места заказа.
 * Сюда холст попасть не может ни при каких обстоятельствах: вкладка «Дизайн» —
 * одна из четырёх, и платить за konva на «Клиенте» и «ТЗ и цене» никто не должен.
 * Ключи — по `name`, как у ErpApp: OrderStudioApp ленив из App.jsx и в манифесте
 * лежит под `_OrderStudioApp-<hash>.js`.
 */
const orderAppKey = findKey('OrderStudioApp', 'src/orderstudio/OrderStudioApp.jsx');
const workplaceKey = findKey('OrderWorkplace', 'src/orderstudio/workplace/OrderWorkplace.jsx');
if (!orderAppKey || !workplaceKey) {
  fail('в манифесте нет OrderStudioApp или OrderWorkplace — оболочка Order переехала, поправьте страж');
}
const order = staticGraph(manifest, [entryKey, orderAppKey, workplaceKey].filter(Boolean));
const orderJs = report('Оболочка Order — JS (вход + OrderStudioApp + OrderWorkplace)', order.js);

/**
 * Сид флэтов (`design/seed/**`: `seedFlats` с 67 SVG через `import.meta.glob(..., '?raw')`)
 * — только в чанке кнопки «Загрузить типовые флэты». Два признака, потому что статический
 * импорт вклеивается в чанк импортёра без своей записи в манифесте:
 *   · ключи манифеста под `src/orderstudio/design/seed/` (ленивый случай, отдельные SVG);
 *   · содержимое: ключи `import.meta.glob` — строки `./flats/<имя>.svg` — переживают
 *     минификацию и встречаются только в коде сида (мутация 17.10: статический импорт
 *     сида в OrderWorkplace по манифесту НЕ виден, по содержимому — виден).
 */
const SEED_MARKER = /\.\/flats\/[a-z0-9-]+\.svg/;
const seedFiles = Object.entries(manifest)
  .filter(([k, v]) => k.includes('src/orderstudio/design/seed/') || v.name === 'seedFlats')
  .map(([, v]) => v.file);
const isSeed = (f) => seedFiles.includes(f) || SEED_MARKER.test(readFileSync(join(DIST, f), 'utf8'));
for (const f of order.js) {
  const vendor = DESIGN_VENDORS.find((name) => f.includes(name));
  if (vendor) fail(`${vendor} попал в оболочку Order (${f}) — холст и PDF обязаны быть ленивыми`);
}
for (const f of new Set([...shell.js, ...order.js])) {
  if (isSeed(f)) fail(`сид флэтов попал во вход или оболочку (${f}) — он грузится только кнопкой`);
}

/**
 * Маркер холста — литерал `data-design-canvas` в `DesignTab.jsx` (тот же приём,
 * что у agentation выше). Статический импорт Rollup вклеивает в чанк импортёра
 * без своей записи в манифесте, поэтому ищем по содержимому файлов, а не по ключам.
 * Проверено мутацией 17.10: статический импорт DesignTab в OrderWorkplace —
 * маркер в чанке OrderWorkplace, страж красный.
 */
const CANVAS_MARKER = 'data-design-canvas';
const withMarker = [...new Set([...shell.js, ...order.js])].filter(
  (f) => readFileSync(join(DIST, f), 'utf8').includes(CANVAS_MARKER),
);
if (withMarker.length) {
  fail(`холст попал во вход или оболочку (${withMarker.join(', ')}) — DesignTab обязан быть ленивым`);
} else {
  console.log('✓ холст вкладки «Дизайн» не попал ни во вход, ни в оболочки ERP и Order');
}

const canvasKey = designKey('DesignTab', 'src/orderstudio/design/ui/DesignTab.jsx');
const canvasJs = canvasKey ? minus(staticGraph(manifest, [canvasKey]).js, order.js) : [];
const canvasTotal = canvasKey ? report('Холст — JS (DesignTab минус оболочка Order)', canvasJs).total : null;
if (canvasKey) check('Холст «Дизайн», JS', canvasTotal, BUDGETS.designCanvas);

/*
 * Кэши картинок: PDF макета доступен только с флэтом и размещениями — к этому
 * моменту холст (или превью телефона) уже загрузил оба кэша, чтобы их показать;
 * pdfjs грузит конвейер логотипа, а он сам статически читает `sniff`. Поэтому
 * PDF и pdfjs считаются за вычетом кэшей, как и за вычетом холста.
 */
const flatImagesKey = designKey('flatImages', 'src/orderstudio/design/assets/flatImages.ts', 'src/orderstudio/design/assets/imageLayer.ts');
const artworkImagesKey = designKey('artworkImages', 'src/orderstudio/design/assets/artworkImages.ts', 'src/orderstudio/design/assets/imageLayer.ts');
const imageKeys = [flatImagesKey, artworkImagesKey].filter(Boolean);
const imagesJs = imageKeys.length ? minus(staticGraph(manifest, imageKeys).js, order.js, canvasJs) : [];
const imagesTotal = imageKeys.length ? report('Кэши картинок — JS (flatImages + artworkImages минус холст и оболочка Order)', imagesJs).total : null;
if (imageKeys.length) check('Кэши картинок холста, JS', imagesTotal, BUDGETS.designImages);

const panelKey = designKey('DesignSide', 'src/orderstudio/design/ui/panel/DesignSide.jsx', 'src/orderstudio/design/ui/DesignTab.jsx');
const panelJs = panelKey ? minus(staticGraph(manifest, [panelKey]).js, order.js, canvasJs, imagesJs) : [];
const panelTotal = panelKey ? report('Панель — JS (DesignSide минус холст, картинки и оболочка Order)', panelJs).total : null;
if (panelKey) check('Панель «Дизайн», JS', panelTotal, BUDGETS.designPanel);
// Части сцены «Дизайн» 2.0 (веха 5в, Э2): полосы над холстом и под ним — один ленивый модуль
const stageKey = designKey('StageParts', 'src/orderstudio/design/ui/stage/StageParts.jsx', 'src/orderstudio/design/ui/DesignTab.jsx');
const stageJs = stageKey ? minus(staticGraph(manifest, [stageKey]).js, order.js, canvasJs, imagesJs, panelJs) : [];
const stageTotal = stageKey ? report('Части сцены — JS (StageParts минус холст, картинки, панель и оболочка Order)', stageJs).total : null;
if (stageKey) check('Части сцены «Дизайн», JS', stageTotal, BUDGETS.designStage);
// Лист «Выкройка» (веха 5в, Э2б): по кнопке и только с лекалами — свой ленивый чанк
const patternKey = designKey('PatternSheet', 'src/orderstudio/design/ui/stage/PatternSheet.jsx', 'src/orderstudio/design/ui/DesignTab.jsx');
const patternJs = patternKey ? minus(staticGraph(manifest, [patternKey]).js, order.js, canvasJs, imagesJs, panelJs, stageJs) : [];
const patternTotal = patternKey ? report('Лист выкройки — JS (PatternSheet минус холст, картинки, панель, части сцены и оболочка Order)', patternJs).total : null;
if (patternKey) check('Лист выкройки «Дизайн», JS', patternTotal, BUDGETS.designPattern);
// Файлы печати (веха 5в, Э4а): ZIP по кнопке — свой ленивый чанк
const printFilesKey = designKey('printFiles', 'src/orderstudio/design/export/printFiles.ts', 'src/orderstudio/design/ui/stage/PrintFilesButton.jsx');
const printFilesJs = printFilesKey ? minus(staticGraph(manifest, [printFilesKey]).js, order.js, canvasJs, imagesJs, panelJs, stageJs) : [];
const printFilesTotal = printFilesKey ? report('Файлы печати — JS (printFiles минус холст, картинки, панель, части сцены и оболочка Order)', printFilesJs).total : null;
if (printFilesKey) check('Файлы печати «Дизайн», JS', printFilesTotal, BUDGETS.designPrintFiles);
if (canvasKey) {
  const sum = (files) => files.reduce((n, f) => n + gzipSync(readFileSync(join(DIST, f))).length, 0);
  console.log(`  вкладка «Дизайн» при открытии (холст + картинки + панель): ${sum([...canvasJs, ...imagesJs, ...panelJs])} Б gzip (справочно)`);
}

const pdfKey = designKey('exportPdf', 'src/orderstudio/design/export/exportPdf.ts', 'src/orderstudio/design/ui/DesignTab.jsx');
let pdfTotal = null;
if (pdfKey) {
  const files = minus(staticGraph(manifest, [pdfKey]).js, order.js, canvasJs, imagesJs);
  pdfTotal = report('PDF макета — JS (exportPdf минус холст, картинки и оболочка Order)', files).total;
  check('PDF макета, JS', pdfTotal, BUDGETS.designPdf);
}

const pdfjsKey = designKey('loadPdf', 'src/orderstudio/design/assets/loadPdf.ts', 'src/orderstudio/design/ui/DesignTab.jsx');
let pdfjsTotal = null;
if (pdfjsKey) {
  const files = minus(staticGraph(manifest, [pdfjsKey]).js, order.js, canvasJs, imagesJs);
  pdfjsTotal = report('pdfjs — JS (loadPdf минус холст, картинки и оболочка Order)', files).total;
  check('pdfjs, JS', pdfjsTotal, BUDGETS.designPdfjs);
}

// ── Веха 5б: konva вне списка флэтов, редактор флэта, разница с базой ───────
const flats = checkFlatsAdmin({ manifest, root: ROOT, findKey, staticGraph, report, check, fail, minus, orderJs: order.js, canvasJs });
// ── Веха 6+7: рабочее место, движок ТЗ по клику, экран запуска без стора ERP ──
const m67 = checkTzLaunch({
  manifest, root: ROOT, dist: DIST, findKey, staticGraph, report, check, fail, minus,
  entryKey, orderAppKey, workplaceKey, orderJs: order.js,
});
// ── Веха 8: потолки оболочки Order, «Справочник моделей» и «Экспресс» (К11) ──
checkRestyle({ manifest, staticGraph, report, check, fail, findKey, entryKey, orderAppKey, workplaceKey });
// ── Веха 8, задача 9: подмена профиля dev-автологина не в сборке (все js `dist/assets`) ──
const distJs = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'))
  .map((f) => ({ name: `assets/${f}`, text: readFileSync(join(DIST, 'assets', f), 'utf8') }));
checkNoDevProfiles({ files: distJs, fail, log: console.log });
const konvaFile = Object.values(manifest).find((v) => v.name === 'vendor-konva')?.file;
console.log('\nРазница с базой (справочно, потолки — выше)');
baseline.reference('orderShell', 'Оболочка Order', orderJs.total);
baseline.reference('designCanvas', 'Холст «Дизайн»', canvasTotal);
baseline.reference('vendorKonva', 'vendor-konva', konvaFile ? gzipSize(konvaFile) : null);
baseline.reference('designImages', 'Кэши картинок', imagesTotal);
baseline.reference('designPanel', 'Панель «Дизайн»', panelTotal);
baseline.reference('designPdf', 'PDF макета', pdfTotal);
baseline.reference('designPdfjs', 'pdfjs', pdfjsTotal);
baseline.reference('flatsTab', 'Вкладка «Флэты и зоны»', flats.flatsTabTotal);
baseline.reference('flatEditor', 'Редактор флэта', flats.editorTotal);
baseline.reference('workplace', 'Рабочее место', m67.workplaceTotal);
baseline.reference('tzPdf', 'ТЗ PDF', m67.tzPdfTotal);
baseline.reference('launchScreen', 'Экран запуска', m67.launchTotal);
baseline.done();

console.log(
  process.exitCode
    ? '\nБюджет НЕ выполнен.'
    : `\nБюджет выполнен. Оболочка: ${shellJs.total + shellCss.total} Б gzip (JS+CSS).`,
);
