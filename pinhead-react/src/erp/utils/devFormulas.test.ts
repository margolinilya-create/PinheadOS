import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from './migrations.testutil';
import { devDueDate, devOverdue, isSuccessOutcome } from './experimentalTasks';

/**
 * ПРОТЕСТИРОВАННАЯ ФУНКЦИЯ, КОТОРУЮ НИКТО НЕ ЗОВЁТ, — ХУЖЕ ОТСУТСТВУЮЩЕЙ.
 *
 * Обход мёртвых экспортов 05.09 нашёл в разработке образцов две такие пары:
 *
 *   · `devOverdue` — пять тестов, НОЛЬ вызывающих. Правило «срок разработки:
 *     свой, иначе срока заказа» при этом было дословно переписано в реестре
 *     разработок и в карточке доски ЭКС, причём карточка повторила и вторую
 *     половину («и исход ещё не проставлен»), а реестр — только первую.
 *   · `isSuccessOutcome` — своя докстрока прямо объясняла, ради каких мест
 *     функция заведена; в этих местах стояло сравнение со строкой, четырежды.
 *
 * Тесты при этом были зелёные и проверяли код, которого не видит ни один
 * человек. Сторож смотрит на ВЫЗОВ, а не на существование функции.
 */

const ERP = join(process.cwd(), 'src/erp');

function sources(): [string, string][] {
  const out: [string, string][] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(join(ERP, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(jsx|tsx|ts|js)$/.test(e.name) && !/\.test\./.test(e.name)) {
        out.push([rel, withoutJsComments(readFileSync(join(ERP, rel), 'utf8'))]);
      }
    }
  })('');
  return out;
}

describe('срок и исход разработки считаются одной функцией', () => {
  it('поведение: срок берётся свой, иначе заказа', () => {
    expect(devDueDate({ due_date: '2026-09-10', order: { due_date: '2026-09-01' } }))
      .toBe('2026-09-10');
    expect(devDueDate({ due_date: null, order: { due_date: '2026-09-01' } }))
      .toBe('2026-09-01');
    expect(devDueDate({ due_date: null, order: null })).toBeNull();
  });

  it('закрытая разработка не бывает просроченной', () => {
    const past = { due_date: '2020-01-01', order: null };
    expect(devOverdue({ ...past, outcome: null })).toBe(true);
    expect(devOverdue({ ...past, outcome: 'ready_for_serial' })).toBe(false);
  });

  it('правило срока нигде не переписано руками', () => {
    const hand = sources()
      // Сам источник правила — там оно и должно быть записано
      .filter(([f]) => f !== 'utils/experimentalTasks.ts')
      .filter(([, t]) => /due_date\s*\|\|\s*\w+\.order\?\.due_date/.test(t))
      .map(([f]) => f);
    expect(hand, `своя копия правила срока: ${hand.join(', ')}`).toEqual([]);
  });

  it('успешный исход нигде не сравнивается со строкой', () => {
    const hand = sources()
      .filter(([f]) => f !== 'utils/experimentalTasks.ts' && f !== 'utils/statusUi.ts')
      .filter(([, t]) => /[!=]==\s*'ready_for_serial'|'ready_for_serial'\s*[!=]==/.test(t))
      .map(([f]) => f);
    expect(hand, `сравнение со строкой вместо isSuccessOutcome: ${hand.join(', ')}`).toEqual([]);
    // Сама функция отвечает на тот вопрос, ради которого заведена
    expect(isSuccessOutcome('ready_for_serial')).toBe(true);
    expect(isSuccessOutcome('needs_rework')).toBe(false);
    expect(isSuccessOutcome(null)).toBe(false);
  });

  it('обе функции ДЕЙСТВИТЕЛЬНО зовутся из интерфейса', () => {
    const src = sources().filter(([f]) => f.startsWith('screens/') || f.startsWith('components/'));
    for (const name of ['devDueDate(', 'devOverdue(', 'isSuccessOutcome(']) {
      const callers = src.filter(([, t]) => t.includes(name)).map(([f]) => f);
      expect(callers.length, `${name} снова без вызывающих`).toBeGreaterThan(0);
    }
  });
});
