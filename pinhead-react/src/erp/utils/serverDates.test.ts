import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import {
  MIGRATIONS_DIR, functionBody, latestDefining, latestMatching, migration, withoutComments,
} from './migrations.testutil';

/**
 * Календарная дата на сервере — дата ФАБРИКИ, а не Гринвича.
 *
 * Тот же дефект, что увёл доску плана на двое суток, живёт и в базе: Supabase
 * стоит в UTC (`show TimeZone` → UTC), поэтому `current_date` с 00:00 до 03:00
 * по Москве — это ВЧЕРА. Кладовщик, принимающий подряд в ночную смену, получал
 * возврат вчерашним числом; проверено на живой базе: в 21:30 UTC `current_date`
 * даёт 10.08, а `erp_local_date()` — 11.08, и права цех именно вторая.
 *
 * Сторожим ДЕЙСТВУЮЩИЕ определения, а не файлы: функции пересоздаются целиком,
 * и старая миграция навсегда остаётся в репозитории со старым текстом. Разовые
 * бэкфиллы (UPDATE/INSERT верхнего уровня в уже применённых миграциях) под
 * проверку не попадают намеренно — они отработали один раз и переписывать
 * историю задним числом нечем.
 */

/** Все функции, которые когда-либо определялись в миграциях */
function allFunctionNames(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
    for (const m of migration(file).matchAll(/create or replace function public\.(\w+)\(/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

/** `current_date` как отдельное слово: `erp_local_date` его не содержит */
const BARE_CURRENT_DATE = /(^|[^\w.])current_date\b/i;

describe('erp_local_date — одно место, где назван пояс фабрики', () => {
  const SQL = latestDefining('erp_local_date');

  it('пояс задан явно и ровно один раз', () => {
    const body = functionBody(SQL, 'erp_local_date');
    expect(body).toContain("at time zone 'Europe/Moscow'");
    expect(body).toContain('::date');
  });

  it('функция STABLE и с фиксированным search_path', () => {
    // search_path — требование advisor'а ко всем функциям проекта
    const head = SQL.slice(SQL.indexOf('create or replace function public.erp_local_date('));
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/set search_path to 'public'/i);
  });

  it('право выдано authenticated, а не наследуется от PUBLIC', () => {
    // `revoke … from anon` в одиночку не работает: право приходит от PUBLIC.
    // А без явного grant отвалились бы сами DEFAULT-выражения — они
    // исполняются от лица вставляющего
    expect(SQL).toMatch(/revoke execute on function public\.erp_local_date\(\) from public, anon/i);
    expect(SQL).toMatch(/grant execute on function public\.erp_local_date\(\) to authenticated/i);
  });
});

describe('в действующих определениях нет даты по Гринвичу', () => {
  it.each(allFunctionNames())('%s() не использует current_date', (fn) => {
    // Комментарии снимаются: объяснение «почему тут больше не current_date»
    // содержит то же слово, и тест ловил бы сам себя
    const body = withoutComments(functionBody(latestDefining(fn), fn));
    expect(BARE_CURRENT_DATE.test(body), `${fn}() считает дату в UTC`).toBe(false);
  });

  it.each([
    ['erp_material_receipts', 'received_on'],
    ['erp_subcontract_moves', 'moved_on'],
  ])('DEFAULT %s.%s ставит местную дату', (table, column) => {
    const SQL = latestMatching(
      new RegExp(`alter table ${table}\\s+alter column ${column} set default`, 'i'),
      `DEFAULT ${table}.${column}`,
    );
    const stmt = SQL.slice(SQL.indexOf(`alter table ${table}`));
    expect(stmt.slice(0, 200)).toContain('erp_local_date()');
  });
});

describe('приёмка подряда датируется днём цеха', () => {
  const BODY = functionBody(
    latestDefining('erp_warehouse_fg_accepted'),
    'erp_warehouse_fg_accepted',
  );

  it('дата возврата подрядчика — erp_local_date()', () => {
    expect(BODY).toContain('returned_date = coalesce(returned_date, public.erp_local_date())');
  });

  it('остальная логика приёмки не тронута', () => {
    // Функция пересоздавалась целиком ради одной строки — проверяем, что
    // вместе с ней не уехало то, ради чего она существует
    expect(BODY).toContain("phase = 'accepted'");
    expect(BODY).toContain('erp_can_pack_ship(new.order_id)');
    expect(BODY).toContain('on conflict (order_id, task_type) do nothing');
  });
});
