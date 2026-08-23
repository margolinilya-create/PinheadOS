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
/** Псевдо-путь: обращения через агрегатор ищутся в обоих модулях раздела */
const AGGREGATE = '<aggregate>';
const AGGREGATE_PARTS = [
  join(ERP_DIR, 'erp.module.css'),
  join(ERP_DIR, 'screens.module.css'),
];

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
  // Сам агрегатор пропускаем: он импортирует оба модуля и раскладывает их
  // в объект, а `...screens` регулярка приняла бы за обращение `screens.module`
  if (file === join(ERP_DIR, 'styles.js')) return null;
  const src = withoutComments(readFileSync(file, 'utf8'));
  const modules = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"](.+?\.module\.css)['"]/g)) {
    modules.set(m[1], resolve(dirname(file), m[2]));
  }
  /*
   * Агрегатор `erp/styles.js` — это ОБА модуля раздела сразу. Экраны
   * импортируют его, а не файлы напрямую: динамические обращения
   * (`styles[CHIP[status]]`) нельзя разложить по двум переменным, не потеряв
   * часть классов молча. Для теста он разворачивается в оба набора —
   * иначе сторож объявил бы сломанным ровно то, ради чего агрегатор и заведён.
   */
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"](\.\.?\/)+styles['"]/g)) {
    modules.set(m[1], AGGREGATE);
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

/**
 * Разделение на два модуля держится на четырёх правилах, и каждое куплено
 * падением. Тесты ниже сторожат их, потому что нарушение любого — тихая
 * потеря вида, которую не видит ни typecheck, ни функциональный тест.
 */
describe('границы между erp.module.css и screens.module.css', () => {
  const base = declaredClasses(AGGREGATE_PARTS[0]);
  const screens = declaredClasses(AGGREGATE_PARTS[1]);
  const baseSrc = withoutComments(readFileSync(AGGREGATE_PARTS[0], 'utf8'));
  const screensSrc = withoutComments(readFileSync(AGGREGATE_PARTS[1], 'utf8'));

  it('оба файла непустые — иначе сторож проверяет пустоту', () => {
    expect(base.size).toBeGreaterThan(100);
    expect(screens.size).toBeGreaterThan(50);
  });

  /**
   * `composes` у CSS Modules работает ВНУТРИ файла и только сверху вниз:
   * цель, уехавшая в соседний модуль, роняет сборку («referenced class name
   * … in composes not found»), а дописанная в конец — тоже роняет.
   */
  it('цели composes лежат в том же файле и выше по тексту', () => {
    for (const [src, declared] of [[baseSrc, base], [screensSrc, screens]] as const) {
      for (const m of src.matchAll(/composes:\s*([^;]+);/g)) {
        const at = m.index ?? 0;
        for (const name of m[1].split(/\s+/).filter(Boolean)) {
          if (name === 'from' || name === 'global') continue;
          expect(declared.has(name), `цель composes «${name}» не в этом файле`).toBe(true);
          const decl = src.search(new RegExp(`\\.${name}[\\s,{:]`));
          expect(decl, `«${name}» объявлен ниже своего composes`).toBeLessThan(at);
        }
      }
    }
  });

  /**
   * Уточнение (`deptTabActive`) и его база (`deptTab`) имеют ОДИНАКОВУЮ
   * специфичность — спор решает порядок. Пока файл один, порядок бесплатен;
   * в разных чанках его не существует. Поймано визуальным эталоном очереди
   * цеха: активная вкладка потеряла заливку на обеих ширинах.
   */
  it('уточнение класса лежит в одном файле со своей базой', () => {
    const wrong: string[] = [];
    for (const c of screens) {
      for (const b of base) {
        if (c !== b && c.startsWith(b) && c[b.length] >= 'A' && c[b.length] <= 'Z') {
          wrong.push(`.${c} (база .${b} осталась в erp.module.css)`);
        }
      }
    }
    expect(wrong, 'между чанками порядок не гарантирован:\n' + wrong.join('\n')).toEqual([]);
  });

  /**
   * Класс, чьё имя собирается в коде строкой (`STAGE_CHIP_CLASS[status]`),
   * доказать «нужен только экранам» нельзя — статически такое обращение
   * не видно вовсе.
   */
  it('динамические классы остались в базовом файле', () => {
    const literals = new Set<string>();
    for (const file of sourceFiles(ERP_DIR)) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/'([a-zA-Z]\w*)'|"([a-zA-Z]\w*)"/g)) {
        literals.add(m[1] || m[2]);
      }
    }
    const risky = [...screens].filter((c) => literals.has(c));
    expect(risky, 'имя встречается строкой — обращение может быть динамическим')
      .toEqual([]);
  });
});

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
      for (const [variable, path] of u.modules) {
        declared.set(variable, path === AGGREGATE
          ? new Set(AGGREGATE_PARTS.flatMap((p) => [...declaredClasses(p)]))
          : declaredClasses(path));
      }
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
