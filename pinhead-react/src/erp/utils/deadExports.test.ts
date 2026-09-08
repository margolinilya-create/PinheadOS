import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from './migrations.testutil';

/**
 * ЭКСПОРТ БЕЗ ЕДИНОГО ПОТРЕБИТЕЛЯ — ЭТО МУСОР, И ОН НАКАПЛИВАЕТСЯ МОЛЧА.
 *
 * Обход 05.09 нашёл в разделе десяток таких, и половина оказалась не просто
 * лишней, а ВРЕДНОЙ — потому что рядом с мёртвым экспортом жила копия его
 * правила:
 *
 *   · `devOverdue` — пять тестов, ноль вызовов, а правило «срок разработки:
 *     свой, иначе заказа» переписано руками в ТРЁХ экранах;
 *   · `isSuccessOutcome` — своя докстрока называла места, ради которых функция
 *     заведена, а в этих местах стояло сравнение со строкой;
 *   · `URGENT_DAYS` — «тот же порог, что у `isUrgent`», при литерале 3 внутри
 *     самого `isUrgent`;
 *   · `TZ_PREFIX` — при `` `tz/${scope}/…` `` у единственного писателя;
 *   · `ErpItemLabel` — тип живых данных, которые ЧИТАЕТ цех, не привязанный
 *     ни к чему;
 *   · `QC_DEPT_CODE` — с докстрокой, обещавшей потребителей, которых нет.
 *
 * То есть находка «экспорт мёртв» почти всегда означает «правило выражено
 * дважды», а это главный класс дефекта проекта. Сторож держит счёт на нуле.
 *
 * ЧТО НЕ СТОРОЖИТСЯ. Экспорт, который зовут только тесты, — отдельный вопрос
 * (бывает законным швом: `_setClock`, `clearQueue`). Здесь только полный ноль.
 */

const ERP = join(process.cwd(), 'src/erp');

function collect(): Map<string, string> {
  const out = new Map<string, string>();
  (function walk(dir: string) {
    for (const e of readdirSync(join(ERP, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        out.set(rel, withoutJsComments(readFileSync(join(ERP, rel), 'utf8')));
      }
    }
  })('');
  return out;
}

/** Потребители живут и вне раздела: оболочка, общий стор, спеки */
function outside(): string[] {
  const out: string[] = [];
  const roots = [join(process.cwd(), 'src'), join(process.cwd(), 'e2e')];
  for (const root of roots) {
    (function walk(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (p !== ERP) walk(p); }
        else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(readFileSync(p, 'utf8'));
      }
    })(root);
  }
  return out;
}

const DECL = /^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm;

describe('в разделе нет экспортов без потребителей', () => {
  it('каждый экспорт кто-то зовёт', () => {
    const files = collect();
    const foreign = outside().join('\n');
    const dead: string[] = [];

    for (const [file, text] of files) {
      if (/\.test\.|\.testutil\./.test(file)) continue;
      const names = new Set([...text.matchAll(DECL)].map((m) => m[1]));
      for (const name of names) {
        const re = new RegExp(`\\b${name}\\b`, 'g');
        // В своём файле — всё, кроме строки объявления
        const own = text.split('\n')
          .filter((l) => !new RegExp(
            `^export\\s+(async\\s+)?(function|const|class|type|interface)\\s+${name}\\b`).test(l))
          .join('\n');
        let uses = (own.match(re) || []).length;
        if (!uses) {
          for (const [f2, t2] of files) {
            if (f2 === file) continue;
            if (re.test(t2)) { uses += 1; break; }
          }
        }
        if (!uses && re.test(foreign)) uses += 1;
        if (!uses) dead.push(`${file}: ${name}`);
      }
    }
    expect(dead, `экспорт без потребителей:\n  ${dead.join('\n  ')}`).toEqual([]);
  });
});
