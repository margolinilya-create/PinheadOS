/**
 * Стражи бюджета вехи 5б («Флэты и зоны»), задача 0 (18.10). Подключает их
 * `scripts/bundle-budget.mjs`: там и так 500+ строк, а эти проверки — отдельная тема.
 *
 * ДВЕ ЧАСТИ.
 *
 * 1. БАЗА (`bundle-baseline.json`). «Вход и оболочка ERP не растут» — проверка не по
 *    потолку, а против замера. Критерий однозначный (план 5б, Global Constraints):
 *    · размер БЕЗ СЖАТИЯ с нормализованными хешами совпадает ПОБАЙТНО;
 *    · gzip — в пределах ±16 Б.
 *    Побайтное равенство gzip не годится: хеш ленивого чанка вшит строкой в импортёр
 *    (`"./FlatsTab-C_Ujfb2_.js"`), и новый хеш сдвигает gzip на единицы байт без
 *    регрессии. Поэтому перед счётом в тексте файла заменяются:
 *    · хеши имён (`-[A-Za-z0-9_-]{8}.js|css|…` → `-HASH.js`);
 *    · маркер сборки (`__BUILD_ID__`, берётся из `dist/version.json`): без
 *      `VERCEL_GIT_COMMIT_SHA` это ISO-время, и вход отличался бы длиной строки.
 *    Сборка с любым маркером и любыми хешами ленивых чанков даёт те же числа —
 *    это проверено (README, «Замеры 5б»).
 *    Изменилось — красный с печатью «⚠ … изменилось на N Б» и списком файлов.
 *    Это повод для разбора ДО мерджа, а не для правки ERP (она запрещена). Если рост
 *    осознанный (решение вслух), база переписывается: `npm run bundle:budget -- --write-baseline`
 *    — и причина пишется в README рядом с числами.
 *    Остальные графы (холст, PDF, вкладка флэтов, `vendor-konva`…) — справочно:
 *    печатается разница с базой, решают их собственные потолки.
 *
 * 2. РЕДАКТОР ФЛЭТА И KONVA.
 *    · konva не в СТАТИЧЕСКОМ графе `OrderSettings`, `FlatsTab`, `FlatPreview`: список флэтов
 *      и телефон не платят за холст (≈ 76 кБ). Признаки — чанк `vendor-konva` и модуль
 *      `design/ui/konva.ts` (если он станет общим чанком, у него своя запись в манифесте).
 *    · «Редактор флэта» = граф `admin/flats/FlatEditor` минус оболочка Order минус граф
 *      холста `DesignTab`, потолок — замер задачи 7 + 10 % (53 200 Б gzip, история — у константы).
 *    Модули 5б появляются по задачам: нет исходника — «⧗ ещё нет»; исходник есть, но его
 *    ещё не импортирует владелец (`FlatsTab` для редактора и превью) — «⧗ не подключён»;
 *    подключён, а в манифесте нет — красный. С задачи 7 `FLATS_REQUIRED = true`: всё — красное.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BASELINE_FILE = 'scripts/bundle-baseline.json';
/** Допуск gzip против базы (план 5б): хеш в строке импортёра сдвигает gzip на единицы байт */
const GZIP_TOLERANCE = 16;
/** Хеш имени чанка или ассета Vite — 8 символов base64url перед расширением */
const HASH_RE = /-[A-Za-z0-9_-]{8}(?=\.(?:js|mjs|css|woff2?|ttf|otf|png|svg|jpe?g|webp|gif)\b)/g;

/**
 * Потолок редактора флэта = замер задачи 7 + 10 %. История:
 * · 18.10, задача 0 — 45 000, временный (редактора ещё нет);
 * · 18.10, задача 7 — замер 48 346 Б gzip (после выноса из общих с холстом модулей
 *   иконок `FlatIcon`, сброса кэша событием и чтения бакета `garmentFlatsRead`) → 53 200.
 */
const FLAT_EDITOR_BUDGET = 53_200;
/*
 * Задача 7: true — пропавший из манифеста модуль 5б красный, а не «⧗ пропущено».
 */
const FLATS_REQUIRED = true;

const FLATS_TAB_SRC = 'src/orderstudio/admin/tabs/FlatsTab.jsx';
const ORDER_SETTINGS_SRC = 'src/orderstudio/admin/OrderSettings.jsx';
const FLAT_EDITOR_SRC = 'src/orderstudio/admin/flats/FlatEditor.jsx';
const FLAT_PREVIEW_SRC = 'src/orderstudio/admin/flats/FlatPreview.jsx';
const KONVA_SRC = 'src/orderstudio/design/ui/konva.ts';

export function normalizeText(text, buildId) {
  const plain = buildId ? text.split(buildId).join('BUILD') : text;
  return plain.replace(HASH_RE, '-HASH');
}

/** Сравнение с базой и справочные разницы. `fail` — общий из bundle-budget.mjs */
export function createBaseline({ root, dist, fail, write }) {
  const path = join(root, BASELINE_FILE);
  const version = join(dist, 'version.json');
  const buildId = existsSync(version) ? JSON.parse(readFileSync(version, 'utf8')).build : null;
  const saved = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const next = { strict: {}, reference: {} };

  function measure(files) {
    const perFile = {};
    const digest = createHash('sha256');
    let raw = 0;
    let gzip = 0;
    for (const f of [...files].sort((a, b) => normalizeText(a).localeCompare(normalizeText(b)))) {
      const text = normalizeText(readFileSync(join(dist, f), 'utf8'), buildId);
      const size = { raw: Buffer.byteLength(text), gzip: gzipSync(text).length };
      perFile[normalizeText(f)] = size;
      digest.update(`${normalizeText(f)}\0${text}\0`);
      raw += size.raw;
      gzip += size.gzip;
    }
    return { raw, gzip, sha256: digest.digest('hex'), files: perFile };
  }

  function fileDiff(was, now) {
    const names = new Set([...Object.keys(was ?? {}), ...Object.keys(now)]);
    return [...names].sort().flatMap((name) => {
      const a = was?.[name];
      const b = now[name];
      if (!a) return [`    + ${name}: ${b.raw} Б (${b.gzip} Б gzip)`];
      if (!b) return [`    − ${name}: было ${a.raw} Б (${a.gzip} Б gzip)`];
      if (a.raw === b.raw) return [];
      return [`    ~ ${name}: ${a.raw} → ${b.raw} Б (${b.raw - a.raw > 0 ? '+' : ''}${b.raw - a.raw})`];
    });
  }

  /** Вход и оболочка ERP: не растут ни на байт (без сжатия), gzip ±16 */
  function strict(key, label, files) {
    const now = measure(files);
    next.strict[key] = now;
    if (write) return;
    const was = saved?.strict?.[key];
    if (!was) {
      fail(`${label}: нет базы в ${BASELINE_FILE} — снимите её: npm run bundle:budget -- --write-baseline`);
      return;
    }
    const dRaw = now.raw - was.raw;
    const dGzip = now.gzip - was.gzip;
    if (dRaw !== 0 || Math.abs(dGzip) > GZIP_TOLERANCE) {
      fail(
        `⚠ ${label} изменилось на ${dRaw} Б без сжатия (gzip ${dGzip > 0 ? '+' : ''}${dGzip}) против базы `
        + `${was.raw} / ${was.gzip} — разбор до мерджа, правка ERP запрещена\n${fileDiff(was.files, now.files).join('\n')}`,
      );
      return;
    }
    const same = now.sha256 === was.sha256 ? 'содержимое то же' : 'размер тот же, содержимое другое';
    console.log(`✓ ${label}: как в базе — ${now.raw} Б без сжатия, gzip ${now.gzip} (Δ ${dGzip}), ${same}`);
  }

  /** Справочно: разница с базой, без потолка (потолок у графа свой) */
  function reference(key, label, total) {
    next.reference[key] = total;
    const was = saved?.reference?.[key];
    if (write || was == null || total === null) return;
    const d = total - was;
    console.log(`  ${label}: ${total} Б gzip, база ${was} (${d > 0 ? '+' : ''}${d})`);
  }

  function done() {
    if (!write) return;
    const out = {
      comment: 'База bundle-budget (веха 5б, задача 0). Перезапись — только решением вслух: '
        + 'npm run bundle:budget -- --write-baseline, причина — в design/README.md («Замеры 5б»)',
      ...next,
    };
    writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`\n✎ база записана в ${BASELINE_FILE}`);
  }

  return { strict, reference, done };
}

/**
 * Ключ модуля 5б или null. `importer` — исходник, который его подключает: пока там нет
 * имени модуля, модуль ещё никто не грузит («⧗ не подключён»), а не «пропал».
 */
function flatsKey({ root, findKey, fail }, name, srcPath, importer = null) {
  const key = findKey(name, srcPath);
  if (key) return key;
  const exists = existsSync(join(root, srcPath));
  const wired = exists && (!importer || readFileSync(join(root, importer), 'utf8').includes(name));
  if (FLATS_REQUIRED || wired) {
    fail(`${srcPath} ${exists ? 'подключён' : 'обязателен'}, но не найден в манифесте — проверьте страж`);
  } else if (exists) {
    console.log(`⧗ ${srcPath} ещё не подключён (${importer} его не грузит) — проверка пропущена`);
  } else {
    console.log(`⧗ ${srcPath} ещё нет — проверка пропущена`);
  }
  return null;
}

/** Файлы чанков konva в статическом графе: `vendor-konva` и общий чанк `design/ui/konva.ts` */
export function konvaFiles(manifest, files) {
  const konvaChunk = Object.entries(manifest).find(([k, v]) => k === KONVA_SRC || v.src === KONVA_SRC)?.[1]?.file;
  return files.filter((f) => f.includes('vendor-konva') || f === konvaChunk);
}

/**
 * Проверки 5б. Возвращает размер редактора флэта (или null) — для справки против базы.
 * `ctx`: manifest, root, findKey, staticGraph, report, check, fail, minus, orderJs, canvasJs.
 */
export function checkFlatsAdmin(ctx) {
  const { manifest, staticGraph, report, check, fail, minus, orderJs, canvasJs } = ctx;

  const roots = [
    ['OrderSettings', flatsKey(ctx, 'OrderSettings', ORDER_SETTINGS_SRC)],
    ['FlatsTab', flatsKey(ctx, 'FlatsTab', FLATS_TAB_SRC, ORDER_SETTINGS_SRC)],
    ['FlatPreview', flatsKey(ctx, 'FlatPreview', FLAT_PREVIEW_SRC, FLATS_TAB_SRC)],
  ];
  for (const [name, key] of roots) {
    if (!key) continue;
    const hit = konvaFiles(manifest, staticGraph(manifest, [key]).js);
    if (hit.length) fail(`konva в статическом графе ${name} (${hit.join(', ')}) — редактор обязан грузиться import()`);
    else console.log(`✓ konva не в статическом графе ${name}`);
  }

  const flatsTabKey = roots[1][1];
  let flatsTabTotal = null;
  if (flatsTabKey) {
    const settings = roots[0][1] ? staticGraph(manifest, [roots[0][1]]).js : [];
    const files = minus(staticGraph(manifest, [flatsTabKey]).js, orderJs, settings);
    flatsTabTotal = report('Вкладка «Флэты и зоны» — JS (FlatsTab минус OrderSettings и оболочка Order)', files).total;
  }

  const editorKey = flatsKey(ctx, 'FlatEditor', FLAT_EDITOR_SRC, FLATS_TAB_SRC);
  let editorTotal = null;
  if (editorKey) {
    const files = minus(staticGraph(manifest, [editorKey]).js, orderJs, canvasJs);
    editorTotal = report('Редактор флэта — JS (FlatEditor минус оболочка Order и холст DesignTab)', files).total;
    check('Редактор флэта, JS', editorTotal, FLAT_EDITOR_BUDGET);
  }
  return { flatsTabTotal, editorTotal };
}
