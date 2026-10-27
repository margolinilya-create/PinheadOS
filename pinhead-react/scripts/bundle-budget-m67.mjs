/**
 * Стражи бюджета вехи 6+7 («ТЗ в PDF и запуск»), задача 0 (18.10). Подключает их
 * `scripts/bundle-budget.mjs` (там 550+ строк, а это отдельная тема — как `bundle-budget-5b.mjs`).
 * Замер базы и смысл чисел — `src/orderstudio/tz/README.md`, «Замеры 6+7».
 *
 * ЧЕТЫРЕ ПРОВЕРКИ.
 *
 * 1. «РАБОЧЕЕ МЕСТО» = статический граф `workplace/OrderWorkplace.jsx` минус вход и
 *    `OrderStudioApp` (их человек уже скачал, открыв раздел). Туда статически приедут
 *    модель ТЗ (`tz/model/**`, T2) и `sendToWork` (T5) — граф «ТЗ PDF» их не видит, поэтому
 *    у рабочего места свой потолок: замер задачи 0 + 15 КБ; окончательное число ставит T7.
 *
 * 2. «ТЗ PDF» = статический граф `tz/pdf/tzPdf.ts` минус оболочка Order минус граф
 *    `SummaryTab` (если у него своя запись) минус `vendor-pdf`. jsPDF и svg2pdf (≈ 151 кБ)
 *    общие с PDF макета и сторожатся его потолком («PDF макета» в bundle-budget.mjs);
 *    здесь — только код движка ТЗ. Потолок временный, 60 000 Б; T7 ставит замер T3 + 10 %.
 *
 * 3. `vendor-pdf` НЕ в статическом графе оболочки Order, `SummaryTab` и `LaunchScreen`:
 *    движок ТЗ грузится только по клику (`import()`). Мутация «статический
 *    `import './tz/pdf/tzPdf'` в SummaryTab» даёт красный «ТЗ PDF в оболочке».
 *
 * 4. «ЭКРАН ЗАПУСКА» = граф `launch/LaunchScreen.jsx` минус вход и `OrderStudioApp`.
 *    В нём нет `vendor-pdf`, `vendor-konva` и стора ERP: стор ERP грузит только
 *    динамический граф `bridge/launch.ts` по кнопке «Запустить». Стор ERP своей записи
 *    в манифесте не имеет (Rollup вклеивает его в общий чанк, на 18.10 — `statusUi`),
 *    поэтому признаков два: ключ `src/erp/store/useErpStore.ts` (если появится) и литерал
 *    `[loadBootstrap]` из `erp/store/slices/bootstrapSlice.ts` — строка `console.error`
 *    переживает минификацию, а ERP заморожен, так что она не уедет молча.
 *    Потолок — замер задачи 7 + 10 %.
 *
 * Модули 6+7 появляются по задачам: нет исходника — «⧗ ещё нет»; исходник есть, но экран
 * его ещё не подключил — «⧗ не подключён»; подключён, а в манифесте нет — красный.
 * Задача 7 ставит `M67_REQUIRED = true`: после неё пропавший модуль — всегда красный.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Задача 7: true — пропавший из манифеста модуль 6+7 красный, а не «⧗ пропущено».
 */
export const M67_REQUIRED = true;

/**
 * Потолок «Рабочего места» = замер задачи 0 + 15 000 Б gzip. История:
 * · 18.10, задача 0 — замер 79 705 Б gzip (база 5а + 5б) → 94 705;
 * · 18.10, задача 7 — замер 91 557 (модель ТЗ, чек-лист и `sendToWork` статически —
 *   задача 5); потолок оставлен 94 705 (97 %): рост сверх него — разбор, а не подъём.
 * · 26.10, веха 5в, этап Э1 — замер 94 946. Разбор: рост — защиты, которые обязаны жить
 *   в рабочем месте статически (чек-лист отправки — силуэт другой модели и пределы размера
 *   техники; подсказка пределов в `PrintRow`; `offsetNote` для ТЗ). Ленивым чанком их не
 *   вынести: чек-лист считает число пунктов кнопки в шапке. Потолок 95 700 (+~0,8 %).
 */
export const WORKPLACE_BUDGET = 95_700;
/**
 * «ТЗ PDF» без `vendor-pdf` = замер + 10 %. История: задача 3 (проба) — 26 741;
 * задача 7 (подключён экраном, задача 5) — 28 255 → 31 100.
 */
export const TZ_PDF_BUDGET = 31_100;
/**
 * «Экран запуска» = замер + 10 %. Задача 7 — 52 679 Б gzip (из них общие с
 * рабочим местом `salesTransitions`, `ErpStates`, `styles` ≈ 18,7 кБ) → 57 950.
 * Временный потолок плана 25 000 считал только сам экран, без общих чанков.
 */
export const LAUNCH_BUDGET = 57_950;

export const ERP_STORE_SRC = 'src/erp/store/useErpStore.ts';
/** Литерал стора ERP, переживающий минификацию (`bootstrapSlice`, `console.error`) */
export const ERP_STORE_MARKER = '[loadBootstrap]';

const ORDER_APP_SRC = 'src/orderstudio/OrderStudioApp.jsx';
const SUMMARY_SRC = 'src/orderstudio/workplace/SummaryTab.jsx';
const TZ_PDF_SRC = 'src/orderstudio/tz/pdf/tzPdf.ts';
const LAUNCH_SRC = 'src/orderstudio/launch/LaunchScreen.jsx';

/**
 * Ключ модуля 6+7 или null. Модуль «подключён», когда хоть один из `importers`
 * содержит `needle` (имя модуля или его загрузчика).
 */
function m67Key({ root, findKey, fail, m67Required = M67_REQUIRED }, name, srcPath, importers = [], needle = name) {
  const key = findKey(name, srcPath);
  if (key) return key;
  const exists = existsSync(join(root, srcPath));
  const wired = exists && importers.some((f) => existsSync(join(root, f)) && readFileSync(join(root, f), 'utf8').includes(needle));
  if (m67Required || wired) {
    fail(`${srcPath} ${exists ? 'подключён' : 'обязателен'}, но не найден в манифесте — проверьте страж`);
  } else if (exists) {
    console.log(`⧗ ${srcPath} ещё не подключён (${importers.join(', ')} не грузят ${needle}) — проверка пропущена`);
  } else {
    console.log(`⧗ ${srcPath} ещё нет — проверка пропущена`);
  }
  return null;
}

/** Файлы со стором ERP среди `files`: чанк ключа `useErpStore.ts` или литерал `[loadBootstrap]` */
export function erpStoreFiles({ manifest, dist, files }) {
  const own = Object.entries(manifest).find(([k, v]) => k === ERP_STORE_SRC || v.src === ERP_STORE_SRC)?.[1]?.file;
  return files.filter((f) => f === own || readFileSync(join(dist, f), 'utf8').includes(ERP_STORE_MARKER));
}

const vendorIn = (files, name) => files.filter((f) => f.includes(name));

/**
 * Проверки 6+7. `ctx`: manifest, root, dist, findKey, staticGraph, report, check, fail, minus,
 * entryKey, orderAppKey, workplaceKey, orderJs (граф оболочки Order: вход + OrderStudioApp + OrderWorkplace);
 * `m67Required` — для тестов стража (по умолчанию `M67_REQUIRED`).
 * Возвращает размеры для справки против базы.
 */
export function checkTzLaunch(ctx) {
  const { manifest, staticGraph, report, check, fail, minus, entryKey, orderAppKey, workplaceKey, orderJs } = ctx;
  const sectionJs = staticGraph(manifest, [entryKey, orderAppKey].filter(Boolean)).js;

  let workplaceTotal = null;
  if (workplaceKey) {
    const files = minus(staticGraph(manifest, [workplaceKey]).js, sectionJs);
    workplaceTotal = report('Рабочее место — JS (OrderWorkplace минус вход и OrderStudioApp)', files).total;
    check('Рабочее место, JS', workplaceTotal, WORKPLACE_BUDGET);
  }

  const summaryKey = ctx.findKey('SummaryTab', SUMMARY_SRC);
  const summaryJs = summaryKey ? staticGraph(manifest, [summaryKey]).js : [];
  const pdfInShell = vendorIn([...orderJs, ...summaryJs], 'vendor-pdf');
  if (pdfInShell.length) {
    fail(`ТЗ PDF в оболочке: vendor-pdf в статическом графе оболочки Order или SummaryTab (${pdfInShell.join(', ')}) — движок ТЗ только через import()`);
  } else {
    console.log('✓ vendor-pdf не в статическом графе оболочки Order и SummaryTab');
  }

  const tzPdfKey = m67Key(ctx, 'tzPdf', TZ_PDF_SRC, [SUMMARY_SRC, LAUNCH_SRC], 'tzExport');
  let tzPdfTotal = null;
  if (tzPdfKey) {
    const files = minus(staticGraph(manifest, [tzPdfKey]).js, orderJs, summaryJs).filter((f) => !f.includes('vendor-pdf'));
    tzPdfTotal = report('ТЗ PDF — JS (tzPdf минус оболочка Order, SummaryTab и vendor-pdf)', files).total;
    check('ТЗ PDF, JS', tzPdfTotal, TZ_PDF_BUDGET);
  }

  const launchKey = m67Key(ctx, 'LaunchScreen', LAUNCH_SRC, [ORDER_APP_SRC]);
  let launchTotal = null;
  if (launchKey) {
    const graph = staticGraph(manifest, [launchKey]).js;
    for (const name of ['vendor-pdf', 'vendor-konva']) {
      const hit = vendorIn(graph, name);
      if (hit.length) fail(`${name} в статическом графе LaunchScreen (${hit.join(', ')}) — экран запуска не платит за PDF и холст`);
    }
    const store = erpStoreFiles({ manifest, dist: ctx.dist, files: graph });
    if (store.length) {
      fail(`стор ERP в статическом графе LaunchScreen (${store.join(', ')}) — его грузит только bridge/launch.ts через import()`);
    } else {
      console.log('✓ стор ERP, vendor-pdf и vendor-konva не в статическом графе LaunchScreen');
    }
    launchTotal = report('Экран запуска — JS (LaunchScreen минус вход и OrderStudioApp)', minus(graph, sectionJs)).total;
    check('Экран запуска, JS', launchTotal, LAUNCH_BUDGET);
  }
  return { workplaceTotal, tzPdfTotal, launchTotal };
}
