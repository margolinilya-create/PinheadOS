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
  /*
   * `erp_chat_edit`/`erp_chat_delete` сверяют автора через `<>`, и пустой
   * автор даёт NULL — проверка пропускает любого. Закрывает это страж
   * на таблице: любое изменение текста, удаления или правки у сообщения
   * без автора от вошедшего пользователя — 42501 (проба на бою 01.10).
   */
  const sql = migration(migrationFiles().find((f) => /erp_overdue_chat_request/.test(f))!);
  const guard = withoutComments(functionBody(sql, 'erp_chat_system_guard'));

  it('миграция разрешает пустого автора и ставит страж на UPDATE', () => {
    expect(sql).toMatch(/alter column author_id drop not null/);
    expect(sql).toMatch(/before update on public\.erp_chat_messages[\s\S]*erp_chat_system_guard/);
  });

  it('страж держит текст, удаление и правку системного сообщения', () => {
    expect(guard).toMatch(/old\.author_id is null/);
    expect(guard).toMatch(/\(select auth\.uid\(\)\) is not null/);
    for (const col of ['body', 'deleted_at', 'edited_at']) {
      expect(guard).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(guard).toMatch(/errcode = '42501'/);
  });
});
