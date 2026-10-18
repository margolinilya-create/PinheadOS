// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from './testutil/sourceFiles';

/**
 * МЁРТВЫЙ КЛАСС В ГЛОБАЛЬНОМ CSS ORDER STUDIO — НЕ ЗАПАС, А ЛОВУШКА.
 *
 * `editors.css`, `express.css` и `garment.css` грузятся глобально и живут
 * до своего переезда в CSS-модули (веха 8, задачи 3, 4, 6). Пока они живы,
 * каждое их правило действует на ВСЮ вкладку: экраны ERP, открытые после
 * `/admin`, видят те же классы. Правило без потребителя никто не проверяет
 * глазами, а при переезде его переносят «на всякий случай» — так 18.10
 * в `editors.css` дожили 62 класса печатного превью (`pp-*`) и аналитики
 * (`dash-*`), убранных ещё в вехе 1, а в `express.css` — пять классов
 * экспресса-оверлея (`exp-overlay|panel|header|title|body`).
 *
 * Класс считается живым, если его имя целым словом (соседи — не `[\w-]`)
 * встречается в коде `src` (без тестов). Имена классов в проекте не
 * собираются шаблоном из частей (`pp-${x}`) — проверено при уборке 18.10;
 * появится такая сборка — класс назовётся мёртвым, и это повод назвать его
 * целиком, а не ослаблять сторожа.
 */
const FILES = ['editors', 'express', 'garment'].map((n) => `styles/${n}.css`);

/**
 * Известные мёртвые классы в файлах ДРУГОЙ задачи вехи 8. `garment.css`
 * принадлежит задаче 6 (переезд панелей визарда в модули, файл удаляется
 * целиком) — правка чужого файла в задаче 1 дала бы конфликт слияния
 * «изменён / удалён». Исключение живёт, пока жив файл; протухшее — красное.
 */
const KNOWN_DEAD: Record<string, Record<string, string>> = {
  'styles/editors.css': {
    'sku-ed-header': 'шапка экспресса; экспресс ушёл на свой CSS-модуль (задача 4), editors.css удаляет задача 3',
  },
  'styles/garment.css': {
    'supplier-tabs': 'вкладки поставщиков ткани убраны из FabricGrid; файл уходит в задаче 6',
    'supplier-tab': 'то же',
    'supplier-tab-count': 'то же',
    'validation-warning': 'предупреждение шага визарда v3 (шаги убраны в вехе 3); файл уходит в задаче 6',
  },
  'styles/express.css': {
    'exp-close': 'крестик карточки модели — карточка на примитиве Modal (задача 3); файл уходит в задаче 4',
  },
};

function withoutCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Имена классов из селекторов CSS (`.name`; числа вида `.5px` не попадают) */
function cssClasses(css: string): string[] {
  const text = withoutCssComments(css).replace(/url\([^)]*\)/g, ' ');
  return [...new Set([...text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
}

/** Классы, имени которых нет целым словом в коде */
function deadClasses(classes: readonly string[], code: string): string[] {
  return classes.filter((c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(code));
}

const CODE = sourceFiles(SRC_DIR).map((f) => readSource(f)).join('\n');

describe('глобальный CSS Order Studio без мёртвых классов', () => {
  it('сторож видит мёртвый класс и не путает префикс с целым именем', () => {
    const css = '.pp-page { margin: 0 } .sku-row:hover, .sku-row .x { opacity: .5 } .w { width: 1.5px }';
    const code = 'className="sku-row x w" className={`pp-page-live`}';
    expect(cssClasses(css)).toEqual(['pp-page', 'sku-row', 'x', 'w']);
    // `pp-page-live` не делает живым `pp-page`
    expect(deadClasses(cssClasses(css), code)).toEqual(['pp-page']);
  });

  it('файлы, которые сторожим, не пусты — иначе проверяется пустота', () => {
    const live = FILES.filter((rel) => existsSync(join(SRC_DIR, rel)));
    for (const rel of live) expect(cssClasses(readSource(join(SRC_DIR, rel))).length, rel).toBeGreaterThan(5);
  });

  it('каждый класс используется в src (пока файл жив)', () => {
    const bad: string[] = [];
    for (const rel of FILES) {
      const file = join(SRC_DIR, rel);
      if (!existsSync(file)) continue;
      const allowed = KNOWN_DEAD[rel] ?? {};
      for (const c of deadClasses(cssClasses(readSource(file)), CODE)) {
        if (!(c in allowed)) bad.push(`${rel}: .${c}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('исключения не протухли: класс ещё в файле и всё ещё мёртв', () => {
    const stale: string[] = [];
    for (const [rel, names] of Object.entries(KNOWN_DEAD)) {
      const file = join(SRC_DIR, rel);
      if (!existsSync(file)) continue;
      const classes = cssClasses(readSource(file));
      const dead = new Set(deadClasses(classes, CODE));
      for (const c of Object.keys(names)) {
        if (!dead.has(c)) stale.push(`${rel}: .${c} — ${classes.includes(c) ? 'ожил' : 'удалён'}, убрать исключение`);
      }
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });
});
