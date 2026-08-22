import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
