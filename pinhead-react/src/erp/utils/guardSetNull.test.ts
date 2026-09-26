// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIGRATIONS_DIR, functionBody, latestDefining, withoutComments,
} from './migrations.testutil';

/**
 * ССЫЛКА `on delete set null` У ТАБЛИЦЫ СО СТРАЖЕМ (сессия 68).
 *
 * Удаляя родителя, Postgres обнуляет ссылку UPDATE-ом дочерней строки. Этот
 * UPDATE проходит через BEFORE UPDATE-страж, и `auth.uid()` в нём — того,
 * кто удалял: для стража обнуление неотличимо от правки руками. Страж,
 * который держит такую колонку неизменной (или под правом, которого у
 * удаляющего нет), запирает УДАЛЕНИЕ РОДИТЕЛЯ, и ошибка приходит про чужую
 * таблицу: «позиция-источник карточки не меняется» в ответ на удаление
 * позиции заказа. Проба на бою 24.09: без отдельной ветки удаление позиции,
 * из которой завели модель, падало 42501 даже у админа.
 *
 * Ловушка тихая: удаление падает только у родителя, на которого кто-то
 * ссылается, то есть редко и не на тестовых данных. Поэтому правило
 * сторожится для ВСЕХ стражей, а не для того, на котором её нашли:
 * у каждой такой ссылки таблицы со стражем есть ветка «родитель удалён»
 * (ссылка ушла в NULL, а строки, на которую она указывала, больше нет),
 * либо ссылка записана ниже с причиной, почему ветка не нужна.
 *
 * Источники — сами миграции (какая таблица под каким стражем) и эталон
 * внешних ключей прода `FK_SNAPSHOT.md`: он обновляется после каждой
 * миграции, меняющей ключи, и новая ссылка `set null` попадёт сюда сама.
 */

/** Ссылки, которым ветка не нужна, — с причиной */
const EXEMPT: Record<string, string> = {
  'erp_orders.tz_order_id':
    'меняется под order.manage, а заказ ТЗ удаляют admin, director, rop и менеджер-автор; '
    + 'их роли по умолчанию (director, dispatcher, manager) это право имеют. Пересмотреть '
    + 'на мосте «ТЗ → производство»: сегодня связанных заказов 0, а rop или менеджер '
    + 'с цеховой должностью без order.manage удалить связанный заказ ТЗ не сможет',
};

/** Таблица → её страж: `create trigger … before update on … execute function …_guard()` */
function guardedTables(): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = withoutComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    const re = /create trigger \w+\s+before update on public\.(\w+)\s+for each row execute function public\.(erp_\w+_guard)\(\)/g;
    for (const m of sql.matchAll(re)) out.set(m[1], m[2]);
  }
  return out;
}

/** Ссылки `on delete set null` из эталона внешних ключей прода */
function setNullRefs(): { table: string; column: string; parent: string }[] {
  const text = readFileSync(join(MIGRATIONS_DIR, 'FK_SNAPSHOT.md'), 'utf8');
  const re = /^(erp_\w+) · \w+ · FOREIGN KEY \((\w+)\) REFERENCES (\w+)\(id\) ON DELETE SET NULL$/gm;
  return [...text.matchAll(re)].map((m) => ({ table: m[1], column: m[2], parent: m[3] }));
}

const guards = guardedTables();
const refs = setNullRefs();
const guarded = refs.filter((r) => guards.has(r.table));

describe('ссылка on delete set null у таблицы со стражем', () => {
  it('обход видит стражей и ссылки — иначе проверять нечего', () => {
    // Девять стражей (CLAUDE.md, «Стражей девять, а не пять») и 22 ссылки на 24.09
    expect(guards.size).toBeGreaterThanOrEqual(9);
    expect(refs.length).toBeGreaterThanOrEqual(20);
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(guarded.map((r) => [`${r.table}.${r.column}`, r] as const))(
    '%s: ветка «родитель удалён» или записанная причина',
    (key, r) => {
      if (key in EXEMPT) return;
      const fn = guards.get(r.table) as string;
      const body = withoutComments(functionBody(latestDefining(fn), fn));
      const branch = new RegExp(
        `new\\.${r.column} is null and old\\.${r.column} is not null\\s+`
        + `and not exists \\(select 1 from public\\.${r.parent}\\b[^)]*old\\.${r.column}\\)`,
      );
      expect(body, `${fn}: нет ветки «родитель удалён» для ${key}`).toMatch(branch);
    },
  );

  it('исключения не устаревают — у каждого есть своя ссылка', () => {
    const keys = new Set(guarded.map((r) => `${r.table}.${r.column}`));
    expect(Object.keys(EXEMPT).filter((k) => !keys.has(k))).toEqual([]);
  });
});
