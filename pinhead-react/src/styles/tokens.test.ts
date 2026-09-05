import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож токенов: каждый `var(--x)` ссылается на объявленный токен, и ни один
 * не подпёрт фолбэком.
 *
 * ПОЧЕМУ ЭТО НЕ ПЕДАНТИЗМ. Правило «фолбэки `var(--token, X)` не писать» живёт
 * в CLAUDE.md с волны UX-4, и не проверялось ничем — в CSS их накопилось
 * тридцать одна штука, и часть уже разошлась со значениями токенов:
 *
 *   `var(--color-success, #34c759)` при реальном `#06a77d`
 *   `var(--color-warning, #e6a700)` при реальном `#c87137`
 *   `var(--text-muted, #888)`       при реальном `#666` — причём `#888` это
 *                                   ровно то значение, которое аудит контраста
 *                                   забраковал за 2.81:1
 *
 * Пока токен объявлен, фолбэк не виден: он просто ждёт своего часа. Опечатка
 * в имени токена — и в прод уезжает цвет, которого никто не выбирал.
 *
 * Вторая проверка ловит обратный случай и уже нашла две живые поломки.
 * НЕОБЪЯВЛЕННЫЙ токен без фолбэка делает всё объявление невалидным, и браузер
 * отбрасывает его МОЛЧА:
 *
 *   `erp.module.css` `.warnBox { font-size: var(--type-sm) }` — токена нет,
 *      размер шрифта у предупреждения формы не задавался вовсе;
 *   `RolePreviewBar.module.css` `.btn:hover { border-color: var(--border-str) }`
 *      — токена нет, наведение не меняло рамку.
 *
 * Ни один тест такого не видит: CSS собирается, экран рисуется, просто
 * не так, как написано. Тот же профиль отказа, что у `var(--x))` с лишней
 * скобкой, который прожил в примитиве неизвестно сколько.
 */

const ROOT = join(process.cwd(), 'src');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

/**
 * Комментарии снимаются: объяснение, почему фолбэка больше нет, содержит те же
 * слова, что и фолбэк. На этом сторожа в проекте уже спотыкались дважды.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const FILES = cssFiles(ROOT);
const SOURCES = FILES.map((f) => ({ file: f.slice(ROOT.length + 1), css: withoutComments(readFileSync(f, 'utf8')) }));

/** Все объявленные токены — по всему корпусу CSS, включая палитру `.shell` */
const DECLARED = new Set<string>();
for (const { css } of SOURCES) {
  for (const m of css.matchAll(/(^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)) DECLARED.add(m[2]);
}

describe('CSS-токены', () => {
  it('в корпусе вообще есть что проверять', () => {
    // Страж, который ничего не нашёл, зелен по той же причине, что и исправный
    expect(FILES.length).toBeGreaterThan(10);
    expect(DECLARED.size).toBeGreaterThan(50);
  });

  it('ни один var() не подпёрт фолбэком', () => {
    const hits: string[] = [];
    for (const { file, css } of SOURCES) {
      for (const m of css.matchAll(/var\((--[a-zA-Z0-9-]+)\s*,/g)) {
        hits.push(`${file}: var(${m[1]}, …)`);
      }
    }
    expect(hits, `фолбэк — второй тихий источник правды:\n${hits.join('\n')}`).toEqual([]);
  });

  it('каждый var() ссылается на объявленный токен', () => {
    const unknown: string[] = [];
    for (const { file, css } of SOURCES) {
      for (const m of css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
        if (!DECLARED.has(m[1])) unknown.push(`${file}: ${m[1]}`);
      }
    }
    expect(
      unknown,
      `токена нет — браузер отбрасывает объявление молча:\n${unknown.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * §4.4 обхода 04.09: «мелкий текст ≥12px» записан в `docs/DESIGN.md` как
 * правило проекта — и нарушался ДВАДЦАТЬ ШЕСТЬ раз, включая текст ошибки поля
 * и заголовки дорожек канбана (10px). Правило без сторожа живёт ровно до
 * следующей правки: те же 90 фолбэков `var(--token, X)` копились так же.
 *
 * Порог применяется к CSS РАЗДЕЛА, а не ко всему проекту: у Order Studio
 * своя типографика (uppercase-язык), и переписывать её этим правилом
 * значило бы поменять вид половины интерфейса ради чужой нормы.
 */
/**
 * ТОКЕН, МЕНЯЮЩИЙ СМЫСЛ ОТ МЕСТА МОНТИРОВАНИЯ.
 *
 * `.shell` переопределяет два десятка токенов под язык раздела «Производство».
 * Почти все правки — подгонка ОТТЕНКА: `--accent` #2B2BF0 → #2563EB,
 * `--border-light` #DCDCDC → #E5E7EB. Незаметно и безопасно.
 *
 * А `--border` уезжал с #0A0A0A на #E5E7EB — с почти чёрного на светло-серый,
 * расхождение 665 против 134 у следующего по величине. Это не оттенок, это
 * ДРУГОЙ СМЫСЛ, и он работал только внутри оболочки: `AdminScreen`
 * смонтирован ещё и в Order Studio, вне `.shell`, где токен снова становился
 * чёрным. Проверено в браузере 05.09 — одна и та же таблица прав давала
 * rgb(229,231,235) в разделе и rgb(10,10,10) в Order Studio: жирная чёрная
 * рамка вокруг светло-серой таблицы.
 *
 * Порог 200 выбран между двумя этими числами: подгонку оттенка он пропускает,
 * смену смысла — нет. Исключения перечисляются поимённо с причиной, как ратчет
 * сканера доступности; сейчас их нет.
 */
describe('переопределения .shell не меняют СМЫСЛ токена', () => {
  const MAX_DISTANCE = 200;
  const KNOWN: string[] = [];

  const rgb = (v: string): [number, number, number] | null => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  };

  const declarationsIn = (css: string, selector: RegExp) => {
    const out = new Map<string, string>();
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector.test(block[1].trim())) continue;
      for (const d of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        if (!out.has(d[1])) out.set(d[1], d[2].trim());
      }
    }
    return out;
  };

  it('ни один токен не уезжает дальше порога', () => {
    const index = withoutComments(readFileSync(join(process.cwd(), 'src/index.css'), 'utf8'));
    const erp = withoutComments(readFileSync(join(process.cwd(), 'src/erp/erp.module.css'), 'utf8'));
    const globals = declarationsIn(index, /^:root$/);
    const shell = declarationsIn(erp, /\.shell$/);

    const bad: string[] = [];
    for (const [token, shellValue] of shell) {
      if (KNOWN.includes(token)) continue;
      const globalValue = globals.get(token);
      if (globalValue === undefined) continue;
      const a = rgb(globalValue);
      const b = rgb(shellValue);
      if (!a || !b) continue;
      const dist = a.reduce((sum, x, i) => sum + Math.abs(x - b[i]), 0);
      if (dist > MAX_DISTANCE) {
        bad.push(`${token}: ${globalValue} → ${shellValue} (расхождение ${dist})`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  /**
   * Второй конец того же правила: у `--border` в разделе не осталось носителей,
   * и вернуть его нельзя — глобальное значение чёрное, а раздел рисуется
   * и вне `.shell`. Ищется и в CSS, и в ИНЛАЙН-СТИЛЯХ: тридцатый носитель
   * нашёлся именно в `.jsx`, мимо обхода по CSS.
   */
  it('раздел не использует --border ни в CSS, ни в инлайн-стилях', () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(css|jsx?|tsx?)$/.test(name) || /\.test\./.test(name)) continue;
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/var\(\s*--border\s*\)/g)) {
          void m;
          bad.push(full.slice(process.cwd().length + 1));
        }
      }
    };
    walk(join(process.cwd(), 'src/erp'));
    expect([...new Set(bad)], bad.join(', ')).toEqual([]);
  });
});

describe('мелкий текст не мельче 12px', () => {
  const ERP_CSS = [
    'src/erp/erp.module.css',
    'src/erp/screens.module.css',
    'src/erp/components/Field.module.css',
    'src/erp/components/Button.module.css',
    'src/erp/components/States.module.css',
  ];

  /**
   * ЗНАЧЕНИЕ ТОКЕНА РАЗВОРАЧИВАЕТСЯ, А НЕ ПРОПУСКАЕТСЯ.
   *
   * Первая редакция сторожа читала только ЛИТЕРАЛ (`font-size: 11px`).
   * Перевод кеглей на `var(--type-*)` (05.09) сделал бы её слепой ровно там,
   * где кегль теперь и задаётся: `font-size: var(--type-label)` она
   * не проверяла бы вовсе. Тот же класс, что «сторож, читающий белый список,
   * сторожит белый список».
   *
   * Значения берутся из `src/index.css` — того файла, где токены объявлены
   * (каждый ровно один раз, переопределений темы у размеров нет). Токен,
   * которого там нет, — тоже находка: значит `var()` ссылается в пустоту.
   */
  const TYPE_TOKENS = (() => {
    const css = withoutComments(readFileSync(join(process.cwd(), 'src/index.css'), 'utf8'));
    const out = new Map<string, number>();
    for (const m of css.matchAll(/(--type-[\w-]+):\s*(\d+(?:\.\d+)?)px/g)) {
      out.set(m[1], Number(m[2]));
    }
    return out;
  })();

  it('перечень кегельных токенов не пуст — иначе разворот проверяет пустоту', () => {
    expect(TYPE_TOKENS.size).toBeGreaterThan(3);
  });

  /**
   * ЛИТЕРАЛ, РАВНЫЙ ТОКЕНУ, — ЭТО ПРОПУЩЕННЫЙ ТОКЕН.
   *
   * 05.09 в CSS раздела заменены 287 таких литералов. Замена тождественна
   * по значению (каждый размерный токен объявлен ровно один раз, темой
   * не переопределяется) — все десять визуальных эталонов сошлись пиксель
   * в пиксель, ни один не перегенерирован.
   *
   * Без сторожа они вернутся к следующей правке: ровно так копились
   * 90 фолбэков `var(--token, X)` и 26 нарушений порога мелкого текста.
   *
   * ПРОВЕРЯЮТСЯ ТОЛЬКО СВОЙСТВА, У КОТОРЫХ ТОКЕН ЕСТЬ. Отступы вроде 10px,
   * 14px, 18px остаются литералами намеренно: заводить под них токены —
   * решение о дизайн-системе, а не механическая правка. Ширины, рамки,
   * тени, дорожки сеток и минимум 44px под палец токенами не выражаются
   * вовсе.
   */
  it('литерал, равный значению токена, не пишется в размерных свойствах', () => {
    const index = withoutComments(readFileSync(join(process.cwd(), 'src/index.css'), 'utf8'));
    const tokensOf = (prefix: string) => {
      const out = new Map<string, string>();
      for (const m of index.matchAll(new RegExp(`(--${prefix}[\\w-]+):\\s*(\\d+(?:\\.\\d+)?px)`, 'g'))) {
        if (!out.has(m[2])) out.set(m[2], m[1]);
      }
      return out;
    };
    const SPACE = tokensOf('space');
    const TYPE = tokensOf('type');
    const RADIUS = tokensOf('radius');
    const SPACE_PROPS = /^(gap|row-gap|column-gap|margin|padding)(-(top|right|bottom|left))?$/;

    const bad: string[] = [];
    for (const rel of ERP_CSS) {
      const file = join(process.cwd(), rel);
      if (!existsSync(file)) continue;
      withoutComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
        // Объявление самого токена переписывать, разумеется, нельзя
        if (/^\s*--/.test(line)) return;
        // Условие медиазапроса — не объявление
        if (/@media/.test(line)) return;
        for (const decl of line.matchAll(/([-a-z]+)\s*:\s*([^;{}]+)/g)) {
          const prop = decl[1];
          const table = SPACE_PROPS.test(prop) ? SPACE
            : prop === 'font-size' ? TYPE
              : prop === 'border-radius' ? RADIUS : null;
          if (!table) continue;
          for (const px of decl[2].matchAll(/(?<![\w.(-])(\d+(?:\.\d+)?px)(?![\w-])/g)) {
            const tok = table.get(px[1]);
            if (tok) bad.push(`${rel}:${i + 1} — ${prop}: ${px[1]} → var(${tok})`);
          }
        }
      });
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('ни одного объявления font-size ниже 12px — литералом или токеном', () => {
    const bad: string[] = [];
    for (const rel of ERP_CSS) {
      const file = join(process.cwd(), rel);
      if (!existsSync(file)) continue;
      const css = withoutComments(readFileSync(file, 'utf8'));
      css.split('\n').forEach((line, i) => {
        const lit = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(line);
        if (lit && Number(lit[1]) < 12) bad.push(`${rel}:${i + 1} — ${lit[1]}px`);
        const tok = /font-size:\s*var\((--type-[\w-]+)\)/.exec(line);
        if (tok) {
          const px = TYPE_TOKENS.get(tok[1]);
          if (px === undefined) bad.push(`${rel}:${i + 1} — ${tok[1]} не объявлен`);
          else if (px < 12) bad.push(`${rel}:${i + 1} — ${tok[1]} = ${px}px`);
        }
      });
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
