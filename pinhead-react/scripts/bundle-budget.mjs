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

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MANIFEST = join(DIST, '.vite', 'manifest.json');

/**
 * Бюджеты в БАЙТАХ gzip. «Оболочка» — критерий приёмки аудита 03.08.2026
 * (initial JS < 250 кБ gzip); остальные выставлены по факту замера с запасом
 * ~5%, чтобы страж ловил регрессию, а не мешал обычной работе.
 *
 * ПОТОЛОК ОБОЛОЧКИ СНИЖАЛСЯ 10.08 ДВАЖДЫ: 250 → 222 → 208 кБ.
 *
 * Первый раз — он подошёл к пределу (249 из 250) и перестал бы что-либо
 * сторожить: любая правка ломала бы сборку, а не ловила регрессию. Разбор
 * показал две причины веса: карточка заказа ехала в оболочке из-за хоста,
 * смонтированного вне `<Routes>`, и три «первых» экрана были статикой ради
 * отсутствия мигания. И то и другое стало ленивым — 249 → 210 кБ.
 *
 * Второй раз — стор разделён на ядро и доменную часть (store/domainSlices):
 * склад, подряд, образцы, справочники, план и этапы больше не едут рабочему,
 * который открыл только очередь своего цеха. 208,8 → 198,2 кБ.
 *
 * Потолок ловит оба вида регрессии: возврат экрана в критический путь
 * (это ~30 кБ) и возврат доменного слайса в ядро (~10 кБ). Что именно
 * вернулось, скажет `store/domainSlices.test.ts` — бюджет говорит только
 * «стало больше».
 *
 * ТРЕТИЙ РАЗ СНИЖЕН 22.08: 208 → 200 кБ. `main.jsx` восстанавливал черновик
 * визарда под проверкой `if (FEATURES.orderStudio)`, но импортировал его стор
 * статически — и стор Order Studio, весь `src/data`, `utils/pricing`
 * и `lib/catalogs` ехали во входном чанке при выключенном разделе.
 * Старт раздела переехал в сам раздел: 205,4 → 190,1 кБ.
 *
 * Оставленные ~10 кБ — запас на обычный рост. Потолок, до которого далеко,
 * ничего не сторожит: он должен ловить регрессию, а не подтверждать,
 * что мы пока не выросли.
 *
 * ИЗ ЧЕГО СОСТОЯТ ОСТАВШИЕСЯ 190 кБ (замер 22.08, чтобы не выяснять заново):
 * react + react-dom 60,5 · react-router 31,4 · supabase-js 45,6 · вход 13,1 ·
 * ядро стора ERP 16,0 · примитивы 12,4 · оболочка и прочее ~11. То есть 72 %
 * оболочки — три библиотеки, и наш код там уже не главный вес.
 *
 * ROUTER 31 кБ — ЭТО ЦЕНА `useBlocker`, И ОНА ОСОЗНАННАЯ. Замер показал:
 * `BrowserRouter` вместо `createBrowserRouter` + `RouterProvider` снимает
 * 17,9 кБ (data-router: loaders, actions, fetchers — проект не использует
 * ни одного). Но `useBlocker` требует именно data-router (`useDataRouterContext`
 * в его реализации), а держится на нём защита визарда «не уходи с незавершённым
 * заказом». Флаг `orderStudio` рантайм (URL/localStorage/env), поэтому вырезать
 * ветку на сборке нельзя — обе остались бы в бандле. Своя реализация блокировки
 * ради 18 кБ — переписывание работающей механики; не делаем.
 * Если раздел когда-нибудь уйдёт совсем — эти 18 кБ забираются вместе с ним.
 *
 * ЧЕТВЁРТЫЙ РАЗ СНИЖЕН 23.08: 200 → 194 кБ. Из критического пути ушли стор
 * Order Studio (сброс при выходе переехал в реестр `store/appReset`) и чанк
 * `types` целиком: оболочке из его 32 словарей подписей нужен был ОДИН массив
 * прав, и он переехал в модуль-лист `erp/permissionKeys`. 190,1 → 185,6 кБ.
 *
 * Форма входа ленивой НЕ стала, хотя это дало бы ещё ~3 кБ: `App.test.jsx`
 * сразу покраснел на правиле «пустой экран загрузки — только на первичную
 * проверку сессии». При промахе прогрева человек упирался бы в «Загрузка…»
 * вместо формы — тот самый симптом, из-за которого правило и появилось.
 */
const BUDGETS = {
  shellJs: 194_000,
  /**
   * ПОТОЛОК CSS СНИЖЕН 22.08: 40 → 24 кБ.
   *
   * `App.jsx` импортировал `styles/index.css` безусловно, а тот — все десять
   * файлов Order Studio. Раздел стоит за флагом `orderStudio` и по умолчанию
   * ВЫКЛЮЧЕН, то есть 128 кБ сырого CSS (editors 62, garment 25, extras-zones 16,
   * kanban 10, express 9, wizard 6) ехали каждому, кто открыл только
   * «Производство», — при том что оболочка ERP не использует из них ни одного
   * класса. Теперь эти файлы импортируют сами потребители (`OrderStudioApp`
   * и ленивая `AdminPanel`), и Vite кладёт их в чанк импортёра: 36,7 → 22,1 кБ.
   *
   * 24 кБ оставляют ~2 кБ на обычный рост и ловят возврат любого из шести
   * файлов в глобальный импорт — это ~3 кБ gzip и больше.
   */
  shellCss: 24_000,
  /**
   * СНИЖЕН 22.08: 190 → 160 кБ, вместе с переездом старта Order Studio
   * (см. выше). Вход — это ещё и то, что грузит человек, открывший раздел
   * за флагом; оставлять ему потолок «на 39 кБ выше факта» значит не заметить,
   * как туда вернётся половина каталога.
   *
   * 23.08: 160 → 155 кБ — форма входа и стор Order Studio уехали из входного
   * чанка (13,1 → 10,3 кБ своего кода).
   */
  entryJs: 155_000,
  /** Ни один отдельный чанк не должен незаметно распухнуть */
  singleChunk: 100_000,
};

/** Чанки, которым нечего делать в критическом пути ни при каких обстоятельствах */
const FORBIDDEN_IN_SHELL = [
  // chart.js однажды уже уехал в оболочку: `react/jsx-runtime` не был перечислен
  // в vendor-react, и Rollup приклеил его к первой группе, которая его затребовала.
  // 63 кБ gzip на каждой загрузке — в разделе, где нет ни одного графика.
  'vendor-charts',
  // Order Studio за флагом: если он попал в статический граф — флаг перестал работать
  'OrderStudioApp',
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

for (const { f, size } of [...shellJs.rows, ...shellCss.rows]) {
  if (size > BUDGETS.singleChunk) {
    fail(`чанк ${f} — ${size} Б gzip при пороге ${BUDGETS.singleChunk} на один чанк`);
  }
}

for (const name of FORBIDDEN_IN_SHELL) {
  const hit = [...shell.js, ...shell.css].find((f) => f.includes(name));
  if (hit) fail(`${name} попал в оболочку (${hit}) — проверьте manualChunks в vite.config.js`);
}

console.log(
  process.exitCode
    ? '\nБюджет НЕ выполнен.'
    : `\nБюджет выполнен. Оболочка: ${shellJs.total + shellCss.total} Б gzip (JS+CSS).`,
);
