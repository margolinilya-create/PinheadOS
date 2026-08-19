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
 *
 * САМИ ПРАВИЛА живут в `audit-rules.mjs` и покрыты тестами
 * (`audit-rules.test.js`). Здесь остались только чтение файлов, печать и код
 * возврата: пока правила были внутри этого файла, проверить их было нечем —
 * импорт скрипта запускает аудит, — и два невидимых дефекта (комментарий,
 * принятый за код, и зависимость от порядка обхода файлов) прожили здесь
 * до 19.08.2026, делая аудит красным на одних ложных находках.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import {
  stripCssComments,
  stripJsComments,
  isTokenDeclaration,
  findHexHits,
  findLineHits,
  uncoveredKeyframes,
} from './audit-rules.mjs';

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

const read = (file) => readFileSync(file, 'utf8');
const label = (file) => relative(ROOT, file);

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

const cssFiles = [...walk(STYLES_DIR, '.css'), join(ROOT, 'src/index.css')];

// ── 1. Hardcoded hex colors in CSS ───────────────────────────

const hexHits = cssFiles.flatMap((f) => findHexHits(read(f), label(f)));

printSection(
  '1. Hardcoded hex colors in CSS',
  hexHits,
  'All colors use design tokens',
);

// ── 2. Barlow Condensed not via var(--font-display) ──────────

const barlowHits = cssFiles.flatMap((f) => findLineHits(read(f), /Barlow Condensed/i, {
  file: label(f), strip: stripCssComments, exclude: 'var(--font-display)', skip: isTokenDeclaration,
}));

printSection(
  '2. Barlow Condensed not via var(--font-display)',
  barlowHits,
  'All Barlow Condensed uses go through --font-display',
);

// ── 3. Roboto Mono not via var(--mono) ───────────────────────

const monoHits = cssFiles.flatMap((f) => findLineHits(read(f), /Roboto Mono/i, {
  file: label(f), strip: stripCssComments, exclude: 'var(--mono)', skip: isTokenDeclaration,
}));

printSection(
  '3. Roboto Mono not via var(--mono)',
  monoHits,
  'All Roboto Mono uses go through --mono',
);

// ── 4. @keyframes without prefers-reduced-motion ─────────────

const kfHits = uncoveredKeyframes(cssFiles.map(read)).map((name) => ({
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

const fillHits = componentFiles.flatMap((f) => findLineHits(
  read(f), /fill=["']currentColor["']/, { file: label(f), strip: stripJsComments },
));

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
