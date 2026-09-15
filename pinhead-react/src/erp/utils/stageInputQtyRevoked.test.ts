import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefining, withoutComments } from './migrations.testutil';

/**
 * `erp_stage_input_qty` ЗАКРЫТА ДЛЯ REST — и обязана остаться закрытой.
 *
 * ЧТО НАШЛОСЬ 15.09. Функция — `security definer` без внутреннего гейта,
 * с `authenticated` в ACL, то есть вызывалась любым вошедшим через
 * `/rest/v1/rpc/erp_stage_input_qty`. Формула ровно та, по которой 07.09
 * закрыли `erp_is_manager` и соседей: `prosecdef` без предиката RLS, без
 * внутренней проверки прав и с грантом вошедшему.
 *
 * ПОЧЕМУ ОТЗЫВ, А НЕ ГЕЙТ ВНУТРИ — проверено схемой на живой базе:
 * в предикатах политик функции нет ни разу (отзыв не сломает RLS, в отличие
 * от `is_admin()`), вызывающий ОДИН и это триггерная `erp_clamp_stage_qty`
 * (сама `definer` с владельцем `postgres` — отзыв её не касается), клиент
 * функцию не зовёт вовсе. Внутренний гейт отобрал бы у цеха обрезку факта
 * в его же триггере, то есть дал бы отказ, ради которого функция и `definer`.
 *
 * ЧТО СТОРОЖИТ ЭТОТ ТЕСТ И ПОЧЕМУ ИМЕННО ЭТО. `create or replace` привилегии
 * не сбрасывает, а вот `drop function` + `create` — сбрасывает, и EXECUTE
 * снова достаётся PUBLIC по умолчанию. Такое пересоздание не ломает ничего
 * видимого: функция работает, триггер работает, тесты зелёные — дыра
 * возвращается МОЛЧА. Поэтому проверяется: ПОСЛЕДНЕЕ слово о правах этой
 * функции — отзыв, и он полный (`public`, а не только `anon`: право приходит
 * от PUBLIC, и `revoke … from anon` в одиночку не делает ничего).
 *
 * ГРАНИЦА ЧЕСТНОСТИ, названная вслух: тест читает МИГРАЦИИ, а не базу —
 * живую базу из CI не прочитать. Правило проекта «все изменения схемы идут
 * миграциями» делает этот набор описанием прода; расхождение ловится
 * отдельно, сверкой `npm run migrations:verify`.
 */

const FN = 'erp_stage_input_qty';
const GRANT_RE = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${FN}\\b`, 'i');
const REVOKE_RE = new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${FN}\\b`, 'i');

/** Миграции, говорящие о правах на эту функцию, в порядке версий */
const rightsFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => {
    const body = withoutComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    return GRANT_RE.test(body) || REVOKE_RE.test(body);
  });

describe(`${FN} закрыта для REST`, () => {
  it('о правах этой функции миграции вообще говорят', () => {
    expect(
      rightsFiles.length,
      `у ${FN} нет ни отзыва, ни гранта: security definer без гейта, вызываемая через REST`,
    ).toBeGreaterThan(0);
  });

  it('последнее слово о правах — ОТЗЫВ, а не грант', () => {
    const last = rightsFiles[rightsFiles.length - 1];
    const body = withoutComments(readFileSync(join(MIGRATIONS_DIR, last), 'utf8'));
    expect(
      REVOKE_RE.test(body),
      `последняя миграция о правах ${FN} — ${last}, и в ней нет отзыва: `
      + 'право вернули, дыра открыта заново',
    ).toBe(true);
    expect(
      GRANT_RE.test(body),
      `${last} возвращает грант ${FN}: политик, которым бы он понадобился, нет`,
    ).toBe(false);
  });

  it('отзыв полный — у public, а не только у anon', () => {
    const last = rightsFiles[rightsFiles.length - 1];
    const body = withoutComments(readFileSync(join(MIGRATIONS_DIR, last), 'utf8'));
    const line = body.split('\n').find((l) => REVOKE_RE.test(l)) ?? '';
    /**
     * Право приходит от PUBLIC (`=X/postgres` в ACL), и `anon` его НАСЛЕДУЕТ.
     * `revoke … from anon` без `public` — записанная в проекте ловушка:
     * выглядит как закрытие, не закрывает ничего.
     */
    expect(line.toLowerCase(), `отзыв не упоминает public:\n${line}`).toContain('public');
  });

  it('функция по-прежнему определена — сторож не сторожит пустоту', () => {
    // Отзыв у несуществующей функции прошёл бы молча, и тест был бы зелен
    // на системе, где механизма нет вовсе
    expect(latestDefining(FN), `${FN} не определена ни одной миграцией`).toBeTruthy();
  });
});
