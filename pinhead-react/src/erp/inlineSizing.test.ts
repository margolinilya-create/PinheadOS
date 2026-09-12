import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from './utils/migrations.testutil';

/**
 * РАЗМЕР, ЗАДАННЫЙ СТРОЧНОМУ ЭЛЕМЕНТУ, НЕ ПРИМЕНЯЕТСЯ ВООБЩЕ.
 *
 * Это не теория. 12.09 обход нашёл три живых носителя сразу:
 *   · `.progressFill` — прогресс задания в очереди цеха и в очереди закупки;
 *   · `.loadFill` — виджет «Задачи по цехам» на обзоре;
 *   · `.sgBar` — шкала отступов на витрине дизайн-системы.
 * У всех троих разметка `<span className={styles.X} style={{ width: '40%' }}/>`,
 * а в CSS — `height: 100%` и никакого `display`. По спецификации к строчному
 * элементу не применяются ни `width`, ни `height`: полоса не рисовалась НИ РАЗУ.
 * Трек при этом виден — он flex-item и блокифицируется родителем, — поэтому
 * на экране оставалась пустая серая дорожка, то есть виджет выглядел рабочим
 * и показывал ноль при любом значении.
 *
 * Дефект тихий по построению: CSS собирается, класс существует, тест на
 * разрешение `styles.X` зелёный, разметка и поведение те же. Видно только
 * глазами — и `.routeBarFill` этот `display: block` уже нёс, то есть однажды
 * дефект чинили у ОДНОГО носителя, не спросив, кто ещё читает тот же класс.
 *
 * Сторож спрашивает наоборот: у каждого класса, которому РАЗМЕТКА задаёт
 * размер инлайном, в CSS обязан стоять `display`, при котором размер работает.
 */

const SRC = join(process.cwd(), 'src', 'erp');
const CSS_FILES = [
  'src/erp/erp.module.css',
  'src/erp/screens.module.css',
  'src/erp/components/Button.module.css',
  'src/erp/components/Field.module.css',
  'src/erp/components/States.module.css',
];

/** display, при котором width/height работают */
const SIZED = /^(block|flex|grid|inline-block|inline-flex|inline-grid|table|table-cell|list-item)$/;

function jsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsxFiles(p, out);
    else if (/\.jsx$/.test(name)) out.push(p);
  }
  return out;
}

/** Объявления класса из всех CSS-модулей раздела (тело правила по имени) */
function declarationsFor(cls: string): string {
  let body = '';
  for (const rel of CSS_FILES) {
    const css = readFileSync(join(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const re = new RegExp(`(^|[^\\w-])\\.${cls}(?![\\w-])[^{]*\\{([^}]*)\\}`, 'g');
    for (const m of css.matchAll(re)) body += m[2] + ';';
  }
  return body;
}

/** `composes: base;` — объявления базы тоже считаются */
function displayOf(cls: string, seen = new Set<string>()): string | null {
  if (seen.has(cls)) return null;
  seen.add(cls);
  const body = declarationsFor(cls);
  const own = /display:\s*([\w-]+)/.exec(body);
  if (own) return own[1];
  const composes = /composes:\s*([\w\s]+?);/.exec(body);
  if (composes) {
    for (const base of composes[1].trim().split(/\s+/)) {
      const d = displayOf(base, seen);
      if (d) return d;
    }
  }
  return null;
}

describe('инлайновый размер применяется к элементу, который его принимает', () => {
  /**
   * Ищем ровно ту связку, на которой обожглись: `<span>` (строчный по
   * умолчанию) с классом раздела и инлайновым `width`/`height`.
   */
  const carriers: { file: string; line: number; cls: string; prop: string }[] = [];

  for (const file of jsxFiles(SRC)) {
    const src = withoutJsComments(readFileSync(file, 'utf8'));
    src.split('\n').forEach((line, i) => {
      const m = /<span[^>]*className=\{(?:`[^`]*\$\{)?styles\.(\w+)/.exec(line);
      if (!m) return;
      const sized = /style=\{\{[^}]*\b(width|height|minWidth|minHeight)\b/.exec(line);
      if (!sized) return;
      carriers.push({
        file: file.replace(process.cwd() + '/', ''),
        line: i + 1,
        cls: m[1],
        prop: sized[1],
      });
    });
  }

  it('носители такой связки в разделе есть — иначе сторож проверяет пустоту', () => {
    // На 12.09 их четыре: routeBarFill, loadFill, progressFill (×2), sgBar.
    // Ноль означал бы, что сторож ослеп на переименовании или смене разметки.
    expect(carriers.length).toBeGreaterThan(0);
  });

  it('у каждого носителя объявлен display, при котором размер работает', () => {
    const bad = carriers
      .map((c) => ({ ...c, display: displayOf(c.cls) }))
      .filter((c) => !c.display || !SIZED.test(c.display))
      .map((c) => `${c.file}:${c.line} — .${c.cls} несёт inline-${c.prop},`
        + ` а display ${c.display ? `= ${c.display}` : 'не объявлен'}`
        + ' → строчный элемент размер игнорирует');
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
