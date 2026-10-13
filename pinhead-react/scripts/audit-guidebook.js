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

function scanLines(file, regex) {
  const lines = readFileSync(file, 'utf8').split('\n');
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

/**
 * CSS без комментариев, С СОХРАНЁННОЙ НУМЕРАЦИЕЙ СТРОК.
 *
 * Проверки этого скрипта строчные, а комментарий, объясняющий решение по цвету,
 * содержит те же hex-коды, что и само решение. До 04.09 из-за этого скрипт
 * находил четыре «захардкоженных цвета» — все четыре внутри блока
 * `/* … *\/`, разбирающего, почему #888888 не проходит AA. То же правило,
 * что у `withoutComments` в тестах миграций: проверка «этого здесь нет»
 * ловится собственным объяснением, почему этого нет.
 *
 * Содержимое комментария заменяется пробелами, переводы строк сохраняются —
 * иначе номера строк в отчёте перестали бы совпадать с файлом.
 */
function stripCssComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, ' '));
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
  const lines = stripCssComments(readFileSync(f, 'utf8')).split('\n');
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
  const hits = scanLines(f, /Barlow Condensed/i);
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
  const hits = scanLines(f, /Roboto Mono/i);
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

const keyframeNames = new Set();
const motionCoveredNames = new Set();

/**
 * ДВА ПРОХОДА, А НЕ ОДИН — и это не педантизм.
 *
 * Универсальное правило `*, *::before, *::after { animation-duration: … }`
 * покрывает ВСЕ анимации проекта и живёт в `styles/utils.css`. Пока проход был
 * один, покрытие зависело от ПОРЯДКА ЧТЕНИЯ ФАЙЛОВ: встретив блок в utils.css,
 * скрипт помечал покрытыми только те имена, что успел собрать, — а `fadeSlideIn`
 * объявлен в `wizard.css`, который по алфавиту идёт позже. Результат: скрипт
 * годами сообщал, что анимация визарда не покрыта, хотя она покрыта, и падал
 * с кодом 1. Переставь файлы местами — «находка» исчезла бы сама.
 *
 * Сначала собираем ВСЕ имена, потом ищем покрытие.
 */
const cssContents = [...cssFiles, indexCss].map((f) => stripCssComments(readFileSync(f, 'utf8')));

for (const content of cssContents) {
  for (const m of content.matchAll(/@keyframes\s+([\w-]+)/g)) {
    keyframeNames.add(m[1]);
  }
}

for (const content of cssContents) {
  const motionBlocks = content.matchAll(/@media\s*\(prefers-reduced-motion[^)]*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g);
  for (const block of motionBlocks) {
    const inner = block[0];
    // A wildcard * rule covers everything
    if (/\*/.test(inner)) {
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
