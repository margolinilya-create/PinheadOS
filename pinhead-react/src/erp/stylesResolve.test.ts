import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * КАЖДЫЙ `styles.X` обязан разрешаться в объявленный класс.
 *
 * ЗАЧЕМ. CSS-модуль отдаёт обычный объект: `styles.несуществующийКласс` —
 * это `undefined`, то есть `className={undefined}`. Элемент рисуется, дерево
 * не падает, ни один функциональный тест ничего не замечает — меняется только
 * ВИД. Ровно так ломается разрезание CSS-модуля на части: класс уезжает
 * в файл, которого компонент не импортирует, и экран тихо теряет вёрстку.
 *
 * Визуальные эталоны от этого не спасают: их пять на десктопе и один на
 * телефоне, а экранов раздела два десятка.
 *
 * Тест намеренно ЛОКАЛЬНЫЙ и текстовый — он читает исходники, а не собирает
 * проект: сборка `.jsx` с CSS-модулями в тестовой среде стоила бы дороже,
 * чем проверяемое свойство.
 */

const ERP_DIR = resolve(__dirname);

/** Комментарии снимаем ДО поиска — правило проекта */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Классы, ОБЪЯВЛЕННЫЕ в CSS-модуле (левая часть правил, не `composes`) */
function declaredClasses(cssPath: string): Set<string> {
  const css = withoutComments(readFileSync(cssPath, 'utf8'));
  const out = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const selector = m[1];
    if (selector.includes('@')) continue;
    for (const c of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(c[1]);
  }
  return out;
}

/** Файлы кода раздела (без тестов) */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sourceFiles(p, acc); continue; }
    if (!/\.(jsx?|tsx?)$/.test(name)) continue;
    if (/\.test\.(jsx?|tsx?)$/.test(name)) continue;
    acc.push(p);
  }
  return acc;
}

interface Usage {
  file: string;
  /** Импортированные CSS-модули: имя переменной → абсолютный путь */
  modules: Map<string, string>;
  /** Обращения `<переменная>.<класс>` */
  refs: { variable: string; cls: string }[];
}

function collect(file: string): Usage | null {
  const src = withoutComments(readFileSync(file, 'utf8'));
  const modules = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"](.+?\.module\.css)['"]/g)) {
    modules.set(m[1], resolve(dirname(file), m[2]));
  }
  if (modules.size === 0) return null;

  const refs: { variable: string; cls: string }[] = [];
  const names = [...modules.keys()].join('|');
  // `styles.foo` и `styles['foo']` — обе формы встречаются в разделе
  for (const m of src.matchAll(new RegExp(`\\b(${names})\\.([a-zA-Z]\\w*)`, 'g'))) {
    refs.push({ variable: m[1], cls: m[2] });
  }
  for (const m of src.matchAll(new RegExp(`\\b(${names})\\['([^']+)'\\]`, 'g'))) {
    refs.push({ variable: m[1], cls: m[2] });
  }
  return { file, modules, refs };
}

describe('CSS-модули раздела «Производство»', () => {
  const usages = sourceFiles(ERP_DIR).map(collect).filter(Boolean) as Usage[];

  it('раздел вообще пользуется CSS-модулями (иначе тест сторожил бы пустоту)', () => {
    expect(usages.length).toBeGreaterThan(50);
  });

  /**
   * Динамические обращения. `styles[chipClass]` разрешить статически нельзя,
   * и таких мест в разделе несколько (`STAGE_CHIP_CLASS`, `styles[status.cls]`).
   * Они остаются на совести автора — тест их не видит и не притворяется,
   * что видит.
   */
  it('каждый статический класс объявлен в импортированном модуле', () => {
    const broken: string[] = [];
    for (const u of usages) {
      const declared = new Map<string, Set<string>>();
      for (const [variable, path] of u.modules) declared.set(variable, declaredClasses(path));
      for (const { variable, cls } of u.refs) {
        const set = declared.get(variable);
        if (!set) continue;
        if (!set.has(cls)) {
          broken.push(`${u.file.replace(ERP_DIR, 'src/erp')}: ${variable}.${cls}`);
        }
      }
    }
    expect(broken, 'класс не объявлен — className станет undefined, и экран '
      + 'молча потеряет вёрстку:\n' + broken.join('\n')).toEqual([]);
  });
});
