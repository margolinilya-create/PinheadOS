// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { functionBody, latestDefining, migration, migrationFiles, withoutComments } from './migrations.testutil';

/**
 * ЗАПРОС ПРИЧИНЫ ПРОСРОЧКИ (правка 01.10, п. 5) — сторож миграции.
 *
 * Текст запроса продиктован заказчиком дословно, адресат — конкретный
 * аккаунт, а «один раз на срок» держится ключом журнала. Любое из трёх
 * молча сломанное даёт либо спам каждый день, либо тишину.
 */
describe('erp_overdue_requests_run', () => {
  const sql = latestDefining('erp_overdue_requests_run');
  const body = withoutComments(functionBody(sql, 'erp_overdue_requests_run'));

  it('адресат — аккаунт marika252002@gmail.com, а не менеджер заказа', () => {
    expect(body).toMatch(/'marika252002@gmail\.com'/);
    expect(body).not.toMatch(/o\.manager/);
  });

  it('текст запроса дословный', () => {
    expect(body).toContain("', заказ №'");
    expect(body).toContain("' просрочен. '");
    expect(body).toContain("'Укажите, пожалуйста, причину задержки и ожидаемую дату отгрузки.'");
  });

  it('только активные, не отгруженные, со сроком раньше сегодняшнего', () => {
    expect(body).toMatch(/o\.status = 'active'/);
    expect(body).toMatch(/o\.due_date < v_today/);
    expect(body).toMatch(/shipped_status, 'not_shipped'\) <> 'shipped'/);
  });

  it('один раз на срок: ключ (заказ, срок) в журнале', () => {
    expect(sql).toMatch(/primary key \(order_id, due_date\)/);
    expect(body).toMatch(/r\.order_id = o\.id and r\.due_date = o\.due_date/);
  });

  it('упоминание рабочее: строка упоминания и личное уведомление', () => {
    expect(body).toMatch(/insert into public\.erp_chat_mentions/);
    expect(body).toMatch(/insert into public\.erp_notifications[\s\S]*'chat_mention'/);
  });

  it('системное сообщение без автора; через REST не вызвать', () => {
    expect(body).toMatch(/values \(v_thread, null, v_body/);
    expect(sql).toMatch(/revoke execute on function public\.erp_overdue_requests_run\(\) from public, anon, authenticated/);
  });

  it('стоит в расписании pg_cron', () => {
    expect(sql).toMatch(/cron\.schedule\('erp-overdue-requests'/);
  });
});

describe('системный автор не открывает правку и удаление', () => {
  it.each(['erp_chat_edit', 'erp_chat_delete'])('%s сверяет автора null-безопасно', (fn) => {
    const body = withoutComments(functionBody(latestDefining(fn), fn));
    expect(body).toMatch(/author_id is distinct from v_me/);
    expect(body).not.toMatch(/author_id <> v_me/);
  });

  it('миграция, разрешающая пустого автора, идёт вместе с этой правкой', () => {
    const file = migrationFiles().find((f) => /erp_overdue_chat_request/.test(f));
    expect(file).toBeTruthy();
    expect(migration(file!)).toMatch(/alter column author_id drop not null/);
  });
});
