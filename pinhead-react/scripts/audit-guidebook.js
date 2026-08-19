/**
 * Design Guidebook v2.0 — Automated Audit
 *
 * Checks CSS and component sources against the guidebook rules:
 *   1. Hardcoded hex colors in CSS (should use design tokens)
 *   2. Barlow Condensed not via var(--font-display)
 *   3. Roboto Mono not via var(--mono)
 *   4. @keyframes without prefers-reduced-motion coverage
 *   5. SVG icons using fill="currentColor" (should be stroke-only)
 *
 * Run:  npm run audit
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const STYLES_DIR = join(ROOT, 'src/styles');
const COMPONENTS_DIR = join(ROOT, 'src/components');
const DATA_DIR = join(ROOT, 'src/data');

// ── Helpers ──────────────────────────────────────────────────

function walk(dir, ext) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Комментарии снимаются ПЕРЕД любой проверкой — правило проекта (то же делает
 * `src/utils/date.test.ts`). Без этого аудит ловил объяснение вместо кода:
 * четыре «хардкоженных цвета» в `index.css` — это hex внутри комментариев,
 * которые как раз и обосновывают, почему токен имеет такое значение
 * («был #888888 и не проходил AA»). Написать такое объяснение было
 * единственным способом сделать аудит красным.
 *
 * Номера строк обязаны сохраниться, поэтому содержимое комментария
 * заменяется пробелами, а переводы строк остаются на месте: иначе адрес
 * настоящей находки уехал бы, и человек искал бы её не там.
 */
function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * У JS/JSX комментарии двух видов, и `//` внутри строки (`https://…`) — не
 * комментарий. Поэтому построчный вариант: блочные снимаются, а строчные
 * только когда строка с них НАЧИНАЕТСЯ. Тот же приём, что в тестах проекта.
 */
function stripJsComments(src) {
  return stripCssComments(src)
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') ? '' : l))
    .join('\n');
}

function readCss(file) {
  return stripCssComments(readFileSync(file, 'utf8'));
}

function scanLines(file, regex, strip = stripJsComments) {
  const lines = strip(readFileSync(file, 'utf8')).split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (regex.test(line)) {
      hits.push({ file: relative(ROOT, file), line: i + 1, text: line.trim() });
    }
  });
  return hits;
}

function printSection(title, hits, ok) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
  if (hits.length === 0) {
    console.log(`  ✓ ${ok}`);
  } else {
    console.log(`  ✗ Found ${hits.length} issue(s):\n`);
    for (const h of hits) {
      console.log(`    ${h.file}:${h.line}`);
      console.log(`      ${h.text}\n`);
    }
  }
}

// ── Allowed hex patterns (tokens, rgba, common safe values) ──

const HEX_ALLOWLIST = new Set([
  '#fff', '#ffffff', '#000', '#000000', '#ccc',
]);

function isAllowedHex(line) {
  // Allow lines that are inside :root / CSS custom property definitions
  if (/^\s*--[\w-]+\s*:/.test(line)) return true;
  // Allow rgba() values — they embed hex-like digits but are fine
  if (/rgba?\(/.test(line)) return true;
  // Allow var() fallbacks like var(--color-error, #FF3B30)
  if (/var\(.*#[0-9A-Fa-f]/.test(line)) return true;
  return false;
}

// ── 1. Hardcoded hex colors in CSS ───────────────────────────

const cssFiles = walk(STYLES_DIR, '.css');
const indexCss = join(ROOT, 'src/index.css');

const hexHits = [];
for (const f of [...cssFiles, indexCss]) {
  const lines = readCss(f).split('\n');
  lines.forEach((line, i) => {
    if (isAllowedHex(line)) return;
    // Match 6-digit or 3-digit hex codes
    const m = line.match(/#[0-9A-Fa-f]{3,8}\b/g);
    if (!m) return;
    const bad = m.filter(h => !HEX_ALLOWLIST.has(h.toLowerCase()));
    if (bad.length > 0) {
      hexHits.push({
        file: relative(ROOT, f),
        line: i + 1,
        text: `${line.trim()}  [${bad.join(', ')}]`,
      });
    }
  });
}

printSection(
  '1. Hardcoded hex colors in CSS',
  hexHits,
  'All colors use design tokens',
);

// ── 2. Barlow Condensed not via var(--font-display) ──────────

const barlowHits = [];
for (const f of cssFiles) {
  const hits = scanLines(f, /Barlow Condensed/i, stripCssComments);
  // Filter out lines that already use var(--font-display)
  for (const h of hits) {
    if (!h.text.includes('var(--font-display)')) {
      barlowHits.push(h);
    }
  }
}

printSection(
  '2. Barlow Condensed not via var(--font-display)',
  barlowHits,
  'All Barlow Condensed uses go through --font-display',
);

// ── 3. Roboto Mono not via var(--mono) ───────────────────────

const monoHits = [];
for (const f of cssFiles) {
  const hits = scanLines(f, /Roboto Mono/i, stripCssComments);
  for (const h of hits) {
    if (!h.text.includes('var(--mono)')) {
      monoHits.push(h);
    }
  }
}

printSection(
  '3. Roboto Mono not via var(--mono)',
  monoHits,
  'All Roboto Mono uses go through --mono',
);

// ── 4. @keyframes without prefers-reduced-motion ─────────────

/**
 * ДВА ПРОХОДА, а не один.
 *
 * Раньше имена анимаций собирались и покрытие проверялось в одном цикле по
 * файлам, поэтому глобальный override («гасим ВСЕ анимации») засчитывался
 * только тем анимациям, которые встретились ДО него по порядку обхода.
 * `fadeSlideIn` объявлена в `wizard.css`, а override живёт в `utils.css`,
 * то есть в файле, идущем раньше по алфавиту, — и покрытая анимация
 * рапортовалась как непокрытая. Порядок файлов не должен решать ничего.
 */
const keyframeNames = new Set();
const motionCoveredNames = new Set();
const cssSources = [...cssFiles, indexCss].map(readCss);

for (const content of cssSources) {
  for (const m of content.matchAll(/@keyframes\s+([\w-]+)/g)) {
    keyframeNames.add(m[1]);
  }
}

for (const content of cssSources) {
  const motionBlocks = content.matchAll(/@media\s*\(prefers-reduced-motion[^)]*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g);
  for (const block of motionBlocks) {
    const inner = block[0];
    /**
     * Универсальное правило (`*, *::before, *::after { animation-duration: … }`)
     * гасит вообще все анимации — это стандартный приём W3C для SC 2.3.3,
     * и в проекте он объявлен один раз в `utils.css`.
     *
     * Ищем именно СЕЛЕКТОР, а не любую звёздочку: прежнее `/\*/` срабатывало
     * и на `/*` комментария внутри блока, то есть комментарий засчитывался
     * как покрытие всех анимаций разом.
     */
    if (/(^|[\s,{])\*(?=[\s,:{])/.test(inner)) {
      for (const name of keyframeNames) motionCoveredNames.add(name);
    }
    for (const name of keyframeNames) {
      if (inner.includes(name)) motionCoveredNames.add(name);
    }
  }
}

const uncoveredKeyframes = [...keyframeNames].filter(n => !motionCoveredNames.has(n));
const kfHits = uncoveredKeyframes.map(name => ({
  file: 'src/styles/*',
  line: 0,
  text: `@keyframes ${name} — no prefers-reduced-motion coverage`,
}));

printSection(
  '4. @keyframes without prefers-reduced-motion',
  kfHits,
  'All keyframes respect prefers-reduced-motion',
);

// ── 5. Icons with fill="currentColor" ────────────────────────

const componentFiles = [
  ...walk(COMPONENTS_DIR, '.jsx'),
  ...walk(COMPONENTS_DIR, '.tsx'),
  ...walk(DATA_DIR, '.js'),
  ...walk(DATA_DIR, '.jsx'),
];

const fillHits = [];
for (const f of componentFiles) {
  const hits = scanLines(f, /fill=["']currentColor["']/);
  fillHits.push(...hits);
}

printSection(
  '5. SVG icons with fill="currentColor"',
  fillHits,
  'All icons are stroke-only (no fill="currentColor")',
);

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
const total = hexHits.length + barlowHits.length + monoHits.length + kfHits.length + fillHits.length;
if (total === 0) {
  console.log('  ✓ AUDIT PASSED — all 5 checks clean');
} else {
  console.log(`  ✗ AUDIT: ${total} issue(s) found across 5 checks`);
}
console.log('─'.repeat(60) + '\n');

process.exit(total > 0 ? 1 : 0);
