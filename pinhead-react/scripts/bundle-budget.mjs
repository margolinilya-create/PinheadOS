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
  /**
   * СНИЖЕН 23.08: 194 → 190 кБ. Запись по заказу уехала из ядра в доменный
   * чанк (`store/slices/orderWriteSlice`): создание заказа, отгрузка,
   * удаление, вложения и комментарии не зовёт ни `ErpApp`, ни `layout/*`,
   * ни один общий компонент — только ленивые экраны. Один `createOrder`
   * это 13 кБ исходника: он собирает payload из позиций, маршрута,
   * нанесений, бирок, ТЗ и листа закупки. 185,9 → 181,9 кБ.
   *
   * ПОДНЯТ 20.09: 190 → 195 кБ, ВПЕРВЫЕ ЗА ЧЕТЫРЕ СНИЖЕНИЯ. Правка заказчика
   * п. 4 поселила в ОБОЛОЧКЕ переписку и уведомления: «центр открывается
   * из общей шапки ERP на любом экране», а окно чата переживает переход
   * между разделами. Замер до правки — 189 690 Б при потолке 190 000,
   * то есть запаса не оставалось вовсе: ровно то состояние, от которого
   * предостерегает разбор выше («любая правка ломала бы сборку, а не ловила
   * регрессию»).
   *
   * СНАЧАЛА УБРАНО ВСЁ, ЧТО УБИРАЕТСЯ, и это была не косметика: окно чата,
   * центр уведомлений и всплывающие карточки монтировались в оболочке
   * СТАТИЧЕСКИ и тащили за собой всю подсистему переписки вместе
   * с `screens.module.css` (через агрегатор `erp/styles`, который оболочке
   * импортировать запрещено, — а сторож `stylesResolve` смотрит только
   * на `layout/*`). Плюс `utils/desktopNotify` с синтезом звука ехал
   * в ядре стора. Итого снято 14,7 кБ JS и 7,2 кБ CSS: 205 636 → 190 956
   * и 22 451 → 15 294.
   *
   * ОСТАВШИЕСЯ +1,3 кБ РАЗМАЗАНЫ по четырём чанкам (ядро стора +460, общие
   * примитивы +411, оболочка +217, вход +139) — это колокол со счётчиком,
   * слайс уведомлений, подписки realtime на переписку и новые иконки.
   * Вынимать по двести байт отсюда значит ломать раскладку чанков ради
   * числа, а не ради того, что человек скачивает.
   *
   * ПОТОЛОК 195, А НЕ 191: он обязан ловить РЕГРЕССИЮ — возврат экрана
   * в критический путь (~30 кБ) или доменного слайса в ядро (~10 кБ), —
   * а не полкилобайта обычного роста. 2 % запаса — минимум, при котором
   * страж остаётся стражем, а не красным светом на каждый коммит.
   */
  shellJs: 195_000,
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
   * СНИЖЕН ЕЩЁ РАЗ 23.08: 24 → 20,5 кБ. Тем же приёмом уехал седьмой файл,
   * `forms-buttons.css`, — но НЕ целиком: базовый вид полей, кольца фокуса
   * и две кнопки экранов входа остались глобальными (`styles/forms-base.css`),
   * потому что ими пользуются ERP и статические экраны входа. Вынос файла
   * целиком выглядел бы выгоднее и был бы тремя тихими поломками разом —
   * причины перечислены в шапке `forms-base.css`. 21,6 → 18,8 кБ.
   *
   * СНИЖЕН ТРЕТИЙ РАЗ 23.08: 20,5 → 16 кБ. `erp.module.css` разделён:
   * правила, чьи классы использует только `screens/**`, уехали
   * в `screens.module.css` и едут чанком экранов. 18,8 → 14,3 кБ.
   *
   * Границы разделения держатся на четырёх правилах (цели `composes`,
   * групповые начертания, уточнения базового класса, динамические имена) —
   * их сторожит `erp/stylesResolve.test.ts`. Нарушение любого даёт тихую
   * потерю вида: разметка и поведение те же, отличается вид.
   *
   * Потолок оставляет ~1,7 кБ на обычный рост и ловит возврат файла раздела
   * в глобальный импорт — это ~3 кБ gzip и больше.
   */
  shellCss: 16_000,
  /**
   * СНИЖЕН 22.08: 190 → 160 кБ, вместе с переездом старта Order Studio
   * (см. выше). Вход — это ещё и то, что грузит человек, открывший раздел
   * за флагом; оставлять ему потолок «на 39 кБ выше факта» значит не заметить,
   * как туда вернётся половина каталога.
   *
   * 23.08: 160 → 155 кБ — форма входа и стор Order Studio уехали из входного
   * чанка (13,1 → 10,3 кБ своего кода).
   *
   * ВЕХА 5а, ЗАДАЧА 8 (18.10) — «вход и оболочка ERP не растут». Сверка с замером
   * задачи 0 (сборка с `VERCEL_GIT_COMMIT_SHA=000000000000base`, побайтно по файлам):
   * вход 151 750 → 151 780, оболочка ERP 194 369 → 194 405. Из них КОДОМ выросла
   * только `vendor-react`: 92 193 → 92 215 (+22 Б) — привязки, которые берёт
   * `vendor-konva` (`require` React и `scheduler` для react-reconciler: экземпляр React
   * обязан быть один). Остальное — длина хешей в именах чанков (±10 Б на файл,
   * у ErpApp, входа и примитивов от сборки к сборке). Было +64 Б: помощник CommonJS
   * `commonjsGlobal`, нужный одной konva, жил в `vendor-react` — его снимает плагин
   * `konvaWithoutNodeGlobal` в `vite.config.js` (−42 Б). Потолки не тронуты.
   */
  entryJs: 155_000,
  /** Ни один отдельный чанк не должен незаметно распухнуть */
  singleChunk: 100_000,
  /**
   * ХОЛСТ ВКЛАДКИ «ДИЗАЙН» (веха 5а): граф `design/ui/DesignTab` минус оболочка Order.
   * Потолок — из спеки (строка 126: «холст — один ленивый чанк ≤ 100 кБ gzip»),
   * а не по замеру. Замер спайка 17.10 (konva 9.3.22, react-konva 19.2.7): ядро konva
   * с Stage/Layer/Image/Rect/Line/Text/Transformer и reconciler — 79,3 кБ; `Arrow` тянет
   * `Path` + `BezierFunctions` ещё +8,5 кБ; zod целиком +19 кБ, `zod/mini` +6,5 кБ.
   * Нашему коду холста и панели остаётся ≈ 14–20 кБ — подробности в design/README.md.
   * Задача 8 (18.10), готовый код: 96 627 Б (97 %); вкладка при открытии — 110 469 справочно.
   *
   * РАУНД 1 РЕВЬЮ 6б (17.10): с панелью 6б граф был 109,9 кБ. Потолок НЕ поднят:
   * ядро konva без Tween/Animation/FastLayer (`ui/konvaCore.ts`, −3,1 кБ), кэши
   * картинок, панель и листы PDF — своими чанками по требованию (ниже `designImages`
   * и `designPanel`). Граф холста — 96,6 кБ. ЧЕСТНО: вкладка при открытии (холст +
   * картинки + панель) весит столько же, ≈ 110,4 кБ, — разрезка не уменьшила
   * скачивание, а разнесла его по чанкам; эта сумма печатается справочно ниже.
   */
  designCanvas: 100_000,
  /**
   * КЭШИ КАРТИНОК ХОЛСТА (`assets/flatImages` + `assets/artworkImages`, их грузит
   * `assets/imageLayer` по первой картинке) минус холст и оболочка Order.
   * Замер раунда 1 ревью 6б: 8,5 кБ (санитайзер, проверка байтов, бакеты); потолок +~10 %.
   */
  designImages: 9_400,
  /**
   * ПАНЕЛЬ «ДИЗАЙН» (`ui/panel/DesignSide`, ленивый чанк рядом с холстом) минус холст,
   * кэши картинок и оболочка Order. Замер раунда 1 ревью 6б: 5,3 кБ (панель и проверка
   * макета `preflight`); потолок +~10 %.
   */
  designPanel: 5_800,
  /**
   * PDF МАКЕТА: граф `design/export/exportPdf` минус холст и оболочка Order.
   * Замер спайка 17.10: jsPDF 4.2.1 + svg2pdf.js 2.8.1 (+ fflate, fast-png, pako) —
   * 152,5 кБ. Потолок — замер +5 %.
   *
   * ЗАДАЧА 8 (18.10), готовый код: 159 426 Б (движок, сцена, шрифты PH Maket Sans
   * подмножеством, растр логотипов). Потолок НЕ поднят: 99,6 % — это и есть страж
   * «PDF не растёт молча»; следующая правка движка обязана либо уложиться, либо
   * объяснить рост здесь. Ни во вход, ни в оболочки PDF не попадает (FORBIDDEN_IN_SHELL).
   *
   * ВЕХА 6+7, ЗАДАЧА 3 (18.10) — рост объяснён: ядро (шрифты, svg2pdf в прямоугольник,
   * вывод) вынесено в `design/export/pdfCore.ts`, общее с движком ТЗ (К5). Пока движок
   * ТЗ не подключён экраном — 159 515 Б (+183 к замеру задачи 0, 159 332). Когда
   * подключён (задача 5), Rollup выносит общее ядро отдельным чанком (`pdfCore` ≈ 5,6 кБ
   * на оба движка) — проба 18.10: 160 059 Б (+727). План 6+7 разрешает выносу
   * не больше +2 КБ: потолок = замер задачи 0 + 2 048 = 161 380.
   */
  designPdf: 161_380,
  /**
   * PDFJS (логотипы PDF/AI): граф `design/assets/loadPdf` минус холст и оболочка Order.
   * Замер спайка 17.10: pdfjs-dist 4.10.38 — 98,8 кБ. Воркер (1,38 МБ сырого)
   * — отдельный ассет `?url`, в JS-граф не входит и здесь не считается.
   * Задача 8 (18.10), готовый код: 99 991 Б (96 %).
   */
  designPdfjs: 104_000,
};

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
