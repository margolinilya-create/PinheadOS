// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  functionBody, latestDefining, latestMatching, withoutComments, withoutJsComments,
} from './migrations.testutil';

/**
 * УВЕДОМЛЕНИЯ ЧАТА: СЕРВЕРНАЯ ПОЛОВИНА (правка заказчика 01.10, п. 4).
 *
 * Три обещания документа держит БАЗА, а не клиент, и каждое ломается тихо:
 *
 *   · «открытие колокольчика не отмечает сообщение прочитанным: это
 *     происходит, когда сотрудник увидел его в чате» — уведомление гасит
 *     `erp_chat_mark_seen`. Пропади этот оператор — колокол горит вечно,
 *     а клиент об этом не узнает: он гасит строку у себя локально;
 *   · «@упоминание даёт личное уведомление… ответ — автору» — режим
 *     подписки «Без уведомлений» не вправе их глушить;
 *   · «по настройкам сотрудника… на другом устройстве» — настройка в базе,
 *     и читать/писать её может только владелец.
 */

const clean = (sql: string) => withoutJsComments(withoutComments(sql));

describe('показ сообщения гасит уведомление о нём', () => {
  const sql = clean(latestDefining('erp_chat_mark_seen'));
  const body = clean(functionBody(latestDefining('erp_chat_mark_seen'), 'erp_chat_mark_seen'));

  it('mark_seen ставит read_at СВОИМ уведомлениям об этих сообщениях', () => {
    const at = body.indexOf('update public.erp_notifications');
    expect(at, 'mark_seen не трогает уведомления — колокол не погаснет').toBeGreaterThan(0);
    const stmt = body.slice(at, body.indexOf(';', at));
    expect(stmt).toMatch(/set read_at = now\(\)/);
    // Только свои: invoker и так под политикой, но условие в запросе
    // не даёт полагаться на неё одну
    expect(stmt).toMatch(/user_id = v_me/);
    expect(stmt).toMatch(/message_id = any\s*\(p_message_ids\)/);
    // Уже прочитанное не перезаписывается — иначе read_at соврёт о моменте
    expect(stmt).toMatch(/read_at is null/);
  });

  it('гасит не по числу новых строк просмотра', () => {
    /**
     * Строка просмотра могла появиться раньше выката — тогда `row_count`
     * вставки ноль, а уведомление осталось бы гореть навсегда. Гашение
     * обязано идти безусловно, а не внутри `if v_ins > 0`.
     */
    const at = body.indexOf('update public.erp_notifications');
    expect(body.slice(0, at)).not.toMatch(/if\s+v_ins\s*>\s*0/);
  });

  it('invoker: правка идёт под политикой адресата и стражем read_at', () => {
    expect(sql).toMatch(/erp_chat_mark_seen[\s\S]*?security invoker/);
    expect(sql).not.toMatch(/erp_chat_mark_seen\(p_message_ids uuid\[\]\)[\s\S]{0,80}security definer/);
  });

  it('сравнение с автором null-безопасно', () => {
    // Автор системного сообщения — NULL (миграция 20261001120000):
    // `author_id <> v_me` выкинул бы такое сообщение из отметки молча
    expect(body).toContain('author_id is distinct from v_me');
    expect(body).not.toMatch(/author_id\s*<>\s*v_me/);
  });
});

describe('упоминание и ответ не зависят от режима подписки', () => {
  const body = clean(functionBody(latestDefining('erp_chat_send'), 'erp_chat_send'));
  const at = body.indexOf('insert into public.erp_notifications');
  const insert = body.slice(at, body.indexOf(';', at));
  const branches = insert.split(/union all/);
  const branch = (kind: string) => {
    const hit = branches.find((b) => b.includes(`'${kind}'`));
    if (!hit) throw new Error(`нет ветки ${kind} в рассылке уведомлений`);
    return hit;
  };

  it('рассылка — три ветки: упоминание, ответ, общий поток', () => {
    expect(at).toBeGreaterThan(0);
    expect(branches).toHaveLength(3);
  });

  for (const kind of ['chat_mention', 'chat_reply']) {
    it(`${kind}: режим «Без уведомлений» не глушит`, () => {
      const b = branch(kind);
      expect(b).not.toContain("'none'");
      expect(b).not.toContain('erp_chat_subscriptions');
    });
  }

  it('общий поток по-прежнему подчиняется режиму', () => {
    const b = branch('chat_message');
    expect(b).toContain('erp_chat_subscriptions');
    expect(b).toContain("s.mode = 'all'");
  });

  it('о собственном сообщении не уведомляем — и null-безопасно', () => {
    expect(branch('chat_mention')).toMatch(/u is distinct from v_me/);
    expect(branch('chat_reply')).toMatch(/v_replyto is distinct from v_me/);
    expect(branch('chat_message')).toMatch(/s\.user_id is distinct from v_me/);
    // `<> v_me` в рассылке: при NULL-авторе цитаты строка выпала бы молча
    expect(insert).not.toMatch(/<>\s*v_me/);
  });

  it('упоминание и ответ одному человеку — одно уведомление', () => {
    expect(branch('chat_reply')).toMatch(/not \(v_replyto = any \(v_mentions\)\)/);
    expect(insert).toMatch(/on conflict \(user_id, message_id\)/);
  });
});

describe('настройки уведомлений сотрудника', () => {
  const sql = clean(latestMatching(
    /create table if not exists public\.erp_user_settings/,
    'таблицу erp_user_settings',
  ));

  it('RLS включена', () => {
    expect(sql).toContain('alter table public.erp_user_settings enable row level security');
  });

  for (const cmd of ['select', 'insert', 'update']) {
    it(`${cmd}: своя строка, auth.uid() обёрнут в (select …)`, () => {
      const start = sql.indexOf(`create policy erp_user_settings_${cmd}`);
      expect(start, `нет политики на ${cmd}`).toBeGreaterThan(0);
      const policy = sql.slice(start, sql.indexOf(';', start));
      expect(policy).toContain(`for ${cmd} to authenticated`);
      expect(policy).toContain('user_id = (select auth.uid())');
      // Голый auth.uid() — вызов на каждую строку (advisor auth_rls_initplan)
      expect(policy.replaceAll('(select auth.uid())', '')).not.toContain('auth.uid()');
    });
  }

  it('политики на команду: ни for all, ни DELETE', () => {
    expect(sql).not.toMatch(/on public\.erp_user_settings\s+for all/);
    expect(sql).not.toMatch(/on public\.erp_user_settings\s+for delete/);
  });

  it('anon не получает ничего: отзыв у public и anon, выдача authenticated', () => {
    // `revoke … from anon` в одиночку не работает: право приходит от PUBLIC
    expect(sql).toMatch(/revoke all on table public\.erp_user_settings from public, anon/);
    expect(sql).toMatch(/grant select, insert, update on table public\.erp_user_settings to authenticated/);
    expect(sql).not.toMatch(/grant [^;]*delete[^;]*erp_user_settings/);
  });
});
