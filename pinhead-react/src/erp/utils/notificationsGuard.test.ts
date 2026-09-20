import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  functionBody, latestDefining, latestMatching, withoutComments,
} from './migrations.testutil';
import { columnTypesOf } from '../../types/schema.testutil';

/**
 * ПЕРСОНАЛЬНЫЕ УВЕДОМЛЕНИЯ: СЕРВЕРНАЯ ПОЛОВИНА (14.09).
 *
 * Уведомление — единственная строка в разделе, которая АДРЕСОВАНА ЧЕЛОВЕКУ,
 * и потому ошибиться в ней можно ровно двумя способами, оба тихие:
 *
 *   · дать читать чужие — счётчик непрочитанного начнёт считать по чужим
 *     строкам, а в центре появится то, что человеку не адресовано;
 *   · дать вставлять с клиента — можно прислать кому угодно уведомление
 *     о том, чего не было, и увести его по ссылке куда угодно.
 *
 * Поэтому сторож проверяет не «есть ли политики», а ЧТО ИМЕННО они разрешают.
 */

const sql = withoutComments(latestMatching(
  /create table if not exists public\.erp_notifications/,
  'таблицу erp_notifications',
));

describe('уведомления: доступ', () => {
  it('читает только адресат, а не любой участник', () => {
    // `erp_is_member()` здесь означало бы «все видят все уведомления»
    expect(sql).toMatch(/create policy erp_notifications_read[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)/);
    const readPolicy = sql.slice(sql.indexOf('create policy erp_notifications_read'));
    expect(readPolicy.slice(0, readPolicy.indexOf(';'))).not.toContain('erp_is_member');
  });

  it('INSERT-политики нет вовсе — писать вправе только серверная функция', () => {
    // Отсутствие политики = запрет (RLS). Это и есть «гейт живёт у писателя»:
    // уведомление — следствие события, а не самостоятельное действие
    expect(sql).not.toMatch(/create policy \w+ on public\.erp_notifications\s+for insert/);
  });

  it('правка своя, но узкая: политика есть, а разбор колонок — у стража', () => {
    expect(sql).toMatch(/create policy erp_notifications_update[\s\S]*?for update/);
    expect(sql).toContain('create or replace function public.erp_notification_guard()');
    expect(sql).toMatch(/create trigger erp_notifications_guard[\s\S]*?before update/);
  });
});

describe('уведомления: страж', () => {
  /**
   * Страж читается по ФУНКЦИИ, а не по файлу, где её завели. Он уже пережил
   * одно пересоздание — колонку `message_id` дописала миграция чата, — и
   * сторож, привязанный к миграции «create table», сверялся бы с прежней
   * редакцией: то есть подтверждал бы как норму разбор колонок, которого
   * в базе больше нет. Тот же отказ, что у `serverPermissions`
   * и `auditCoverage`.
   */
  const guardSql = withoutComments(latestDefining('erp_notification_guard'));
  const guard = withoutComments(functionBody(guardSql, 'erp_notification_guard'));

  it('меняется только отметка о прочтении', () => {
    // Без этого право «отметить своё прочитанным» было бы правом переписать
    // себе ссылку и открыть чужую сделку «на нужном месте»
    for (const column of ['user_id', 'kind', 'order_id', 'message_id',
      'title', 'body', 'link', 'created_at']) {
      expect(guard, `${column} не сторожится`)
        .toContain(`new.${column} is distinct from old.${column}`);
    }
    expect(guard).not.toContain('new.read_at is distinct from old.read_at');
  });

  it('service_role проходит: пустой auth.uid() не запирает починку через SQL', () => {
    expect(guard).toMatch(/if \(select auth\.uid\(\)\) is null then\s*\n\s*return new;/);
  });

  it('функция-триггер клиенту не выставлена', () => {
    // Отзыв повторяется в КАЖДОЙ миграции, пересоздающей функцию: `create or
    // replace` сохраняет права, но полагаться на это значит зависеть от того,
    // существовала ли функция раньше
    expect(guardSql).toMatch(/revoke execute on function public\.erp_notification_guard\(\) from anon, authenticated, public/);
  });
});

describe('уведомления: клиент и схема сходятся', () => {
  it('вид уведомления объявлен ОДИНАКОВО в CHECK и в типе', () => {
    // Вид, заведённый в одном месте из двух, даёт 23514 на вставке — в проекте
    // на этом уже ловились с видами вложений (весь unit-набор был зелёным)
    /**
     * СПИСОК БЕРЁТСЯ ИЗ ПОСЛЕДНЕГО МЕСТА, ГДЕ ОН ОБЪЯВЛЕН, а не из создания
     * таблицы: применённую миграцию правят НОВОЙ, поэтому вид, добавленный
     * позже (`chat_message`, правка 20.09), живёт в `add constraint`. Сторож,
     * читающий только `create table`, краснел бы на КАЖДОМ новом виде —
     * то есть требовал бы вернуть список в уже применённую миграцию.
     */
    const kindSql = withoutComments(latestMatching(
      /check \(kind in \([^)]*'chat_mention'/,
      'список видов erp_notifications.kind',
    ));
    const check = kindSql.slice(kindSql.lastIndexOf('check (kind in'));
    const inCheck = [...check.slice(0, check.indexOf(')')).matchAll(/'(\w+)'/g)]
      .map((m) => m[1]).sort();
    const types = readFileSync(join(process.cwd(), 'src/erp/types.ts'), 'utf8');
    const union = types.slice(types.indexOf('export type ErpNotificationKind'));
    const inType = [...union.slice(0, union.indexOf(';')).matchAll(/'(\w+)'/g)]
      .map((m) => m[1]).sort();
    expect(inType).toEqual(inCheck);
    expect(inType.length).toBeGreaterThan(0);
  });

  it('таблица есть в снимке схемы, а обнуляемость колонок повторена в типе', () => {
    // Тип строже схемы — худший из случаев: код считает поле всегда
    // заполненным, tsc это подтверждает, а в проде приезжает null
    const cols = columnTypesOf('erp_notifications');
    for (const name of ['order_id', 'body', 'link', 'read_at']) {
      expect(cols.get(name)?.nullable, `${name} обязан допускать null`).toBe(true);
    }
    for (const name of ['user_id', 'kind', 'title', 'created_at']) {
      expect(cols.get(name)?.nullable, `${name} не должен быть обнуляемым`).toBe(false);
    }
  });
});
