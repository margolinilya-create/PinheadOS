#!/usr/bin/env node
/**
 * Генератор матрицы переходов бизнес-задачи для пробы `erp_biz_tasks.sql`
 * (правки 19.10, п. 7, миграция T2).
 *
 * Источник один — `BIZ_TASK_TRANSITIONS` (`pinhead-react/src/erp/utils/bizTasks.ts`):
 * та же таблица ведёт кнопки карточки и писателя `erp_biz_task_transition`.
 * Матрица — действие × исходный статус × роль (× проверка постановщиком
 * у `submit`/`complete`); ожидание выводится из таблицы, а не пишется руками:
 *
 *   роль не та               → 42501
 *   статус не из `from`      → 22023
 *   submit без проверки,
 *   complete с проверкой     → 22023
 *   иначе                    → OK (новый статус)
 *
 * Паритет «блок пробы = вывод генератора» сторожит `bizTasksRpc.test.ts`.
 * Правка таблицы → `node supabase/probes/gen-biz-task-matrix.mjs` → вставить
 * вывод между маркерами пробы и поправить `total=` в шапке.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Роли пробы: `manage` — должность ERP с `biz_task.manage`, не постановщик */
export const MATRIX_ROLES = ['assignee', 'creator', 'manage', 'watcher', 'outsider'];

export const MATRIX_BEGIN = '-- >>> матрица переходов (gen-biz-task-matrix.mjs)';
export const MATRIX_END = '-- <<< матрица переходов';

/** Ожидание одного случая по таблице переходов */
export function expectFor(t, action, status, role, review) {
  const tr = t[action];
  const allowed = tr.who === 'assignee'
    ? role === 'assignee'
    : role === 'creator' || role === 'manage';
  if (!allowed) return '42501';
  if (!tr.from.includes(status)) return '22023';
  if (action === 'submit' && !review) return '22023';
  if (action === 'complete' && review) return '22023';
  return `OK ${tr.to}`;
}

/** Строки пробы: по одной `pg_temp.p(…)` на случай */
export function buildMatrix(transitions, statuses) {
  const lines = [];
  for (const action of Object.keys(transitions)) {
    const reviews = action === 'submit' || action === 'complete' ? [true, false] : [false];
    for (const status of statuses) {
      for (const role of MATRIX_ROLES) {
        for (const review of reviews) {
          const suffix = reviews.length > 1 ? (review ? '_rev' : '_norev') : '';
          const name = `m_${action}_${status}_${role}${suffix}`;
          const want = expectFor(transitions, action, status, role, review);
          lines.push(
            `select pg_temp.p('${name}', '${want}', pg_temp.mx('${action}', '${status}', ${review}), pg_temp.uid('${role}'));`,
          );
        }
      }
    }
  }
  return lines;
}

/** Таблица и статусы из исходника клиента — для запуска из командной строки */
export function readClientTable(file) {
  const src = readFileSync(file, 'utf8');
  const block = src.slice(src.indexOf('export const BIZ_TASK_TRANSITIONS'));
  const body = block.slice(0, block.indexOf('};'));
  const transitions = {};
  const re = /(\w+): \{ from: \[([^\]]*)\], to: '(\w+)', who: '(\w+)', text: (?:'(\w+)'|null) \}/g;
  for (const m of body.matchAll(re)) {
    transitions[m[1]] = {
      from: [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]),
      to: m[3],
      who: m[4],
      text: m[5] ?? null,
    };
  }
  const st = src.slice(src.indexOf('export const BIZ_TASK_STATUSES'));
  const statuses = [...st.slice(0, st.indexOf('];')).matchAll(/'(\w+)'/g)].map((x) => x[1]);
  return { transitions, statuses };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const { transitions, statuses } = readClientTable(
    join(here, '../../pinhead-react/src/erp/utils/bizTasks.ts'),
  );
  const lines = buildMatrix(transitions, statuses);
  process.stdout.write([MATRIX_BEGIN, ...lines, MATRIX_END].join('\n') + '\n');
  process.stderr.write(`случаев: ${lines.length}\n`);
}
