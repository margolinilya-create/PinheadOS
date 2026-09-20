import { describe, expect, it } from 'vitest';
import {
  functionBody, latestDefining, latestMatching, withoutComments, withoutJsComments,
} from './migrations.testutil';
import { columnTypesOf } from '../../types/schema.testutil';

/**
 * ЧАТ ВНУТРИ СДЕЛКИ: СЕРВЕРНАЯ ПОЛОВИНА (правка 14.09, п. 5).
 *
 * Переписка отличается от всего остального в разделе одним свойством:
 * её НЕЛЬЗЯ ИСПРАВИТЬ ПОТОМ. Редактирования и удаления документ не просит
 * и в первую версию не включает, значит каждая ошибка писателя остаётся
 * в ленте навсегда — сообщение от чужого имени, сообщение, пришпиленное
 * к задаче чужой сделки, дубль после повтора отправки.
 *
 * Поэтому сторож проверяет не «есть ли функция», а ЧТО ИМЕННО она
 * гарантирует, и отдельно — что мимо неё писать нечем.
 */

/** Снимаем и строчные, и блочные комментарии: объяснение «почему правила нет» содержит те же слова */
const clean = (sql: string) => withoutJsComments(withoutComments(sql));

const CORE = clean(latestMatching(
  /create table if not exists public\.erp_chat_messages/,
  'схему чата',
));
const SEND = clean(latestDefining('erp_chat_send'));
const SEND_BODY = clean(functionBody(latestDefining('erp_chat_send'), 'erp_chat_send'));

describe('чат: писать можно только через erp_chat_send', () => {
  it('у переписки нет ни INSERT-, ни UPDATE-, ни DELETE-политики', () => {
    /**
     * Это и есть «гейт живёт у писателя». Появится INSERT-политика — и через
     * REST можно будет вставить сообщение от чужого имени, мимо длины,
     * мимо проверки контекста и БЕЗ уведомлений, которые обязаны уйти той же
     * транзакцией. Проверено на живой базе: прямой insert отвечает
     * «new row violates row-level security policy».
     */
    for (const table of ['erp_chat_messages', 'erp_chat_threads', 'erp_chat_mentions']) {
      for (const cmd of ['insert', 'update', 'delete']) {
        expect(
          CORE,
          `${table}: появилась политика ${cmd} — писать в переписку стало можно мимо erp_chat_send`,
        ).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}\\s+for ${cmd}`));
      }
      expect(CORE).toMatch(new RegExp(`create policy \\w+ on public\\.${table}\\s+for select`));
    }
  });

  it('видимость — участник раздела, а не автор сообщения', () => {
    // Решение владельца 14.09: кто видит сделку, тот видит её обсуждение.
    // Переключатель «контекст / вся сделка» остаётся ВИДОМ, а не правом
    expect(CORE).toMatch(/create policy erp_chat_messages_read[\s\S]*?using \(public\.erp_is_member\(\)\)/);
  });

  it('отметку прочтения человек пишет только себе', () => {
    for (const cmd of ['select', 'insert', 'update']) {
      const policy = CORE.slice(CORE.indexOf(`create policy erp_chat_reads_${
        cmd === 'select' ? 'read' : cmd}`));
      expect(policy.slice(0, policy.indexOf(';')))
        .toContain('user_id = (select auth.uid())');
    }
  });
});

describe('чат: отправка', () => {
  it('гейт участника стоит ПЕРВЫМ, до любой записи', () => {
    // `security definer` обходит RLS целиком — значит проверка принадлежности
    // к разделу обязана быть своей, и обязана стоять раньше вставок
    expect(SEND).toContain('security definer');
    const gate = SEND_BODY.indexOf('erp_is_member');
    const firstInsert = SEND_BODY.indexOf('insert into');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(firstInsert);
  });

  it('повтор отправки не создаёт ни второго сообщения, ни второго уведомления', () => {
    /**
     * Ключ попытки (`utils/attemptKey`) — тот же приём, что у приёмки
     * материала: запрос ушёл, сервер закоммитил, ответ не вернулся, человек
     * нажал «Отправить» второй раз. Дубль определяет САМ INSERT, а не
     * предварительная проверка: между `select exists` и `insert` помещается
     * второй вызов.
     */
    expect(SEND_BODY).toContain('on conflict (author_id, client_key) do nothing');
    // Ранний возврат ОБЯЗАН стоять до рассылки уведомлений
    const dup = SEND_BODY.indexOf("'duplicate',     true");
    const dupAlt = SEND_BODY.indexOf("'duplicate', true");
    const at = dup >= 0 ? dup : dupAlt;
    expect(at, 'нет раннего возврата на повторный ключ').toBeGreaterThan(0);
    expect(at).toBeLessThan(SEND_BODY.indexOf('insert into public.erp_notifications'));
  });

  it('контекст проверяется на принадлежность ЭТОЙ сделке — все три вида', () => {
    // Иначе сообщение, помеченное чужим этапом, всплыло бы в переписке чужой
    // задачи у человека, которому эту сделку никто не открывал
    for (const table of ['erp_order_items', 'erp_item_stages', 'erp_experimental']) {
      expect(SEND_BODY, `${table}: контекст не сверяется со сделкой`)
        .toContain(`from public.${table}`);
    }
    expect(SEND_BODY).toContain('не из этой сделки');
  });

  it('упоминание фильтруется СЕРВЕРОМ по тем же, кто читает обсуждение', () => {
    // Подсказка на клиенте — удобство. Вписать можно только активного
    // и одобренного: иначе упоминание уходило бы тому, кто его не увидит
    const pick = SEND_BODY.slice(SEND_BODY.indexOf('into v_mentions'));
    expect(pick.slice(0, pick.indexOf(';'))).toContain('p.active is true and p.approved is true');
    // Себя не зовут: это собственное действие, а не событие
    expect(pick.slice(0, pick.indexOf(';'))).toContain('p.id <> v_me');
  });

  it('автор — постоянный ID, а не имя текстом', () => {
    // Требование документа: «изменение имени или email не должно нарушать
    // привязку сообщений, упоминаний и уведомлений». Именно этим чат
    // отличается от комментариев заказа, где автор — text
    expect(SEND_BODY).toContain('author_id');
    expect(SEND_BODY).not.toContain('uploaded_by');
    expect(columnTypesOf('erp_chat_messages').get('author_id')?.nullable).toBe(false);
  });
});

describe('чат: чтение', () => {
  const PAGE = clean(latestDefining('erp_chat_page'));
  const UNREAD = clean(latestDefining('erp_chat_unread'));
  const READ_BODY = clean(functionBody(latestDefining('erp_chat_unread'), 'erp_chat_unread'));
  const MARK = clean(functionBody(latestDefining('erp_chat_mark_read'), 'erp_chat_mark_read'));

  it('чтение идёт от лица вызывающего — «одним запросом» не значит «мимо RLS»', () => {
    for (const sql of [PAGE, UNREAD]) expect(sql).toContain('security invoker');
    expect(clean(latestDefining('erp_chat_mark_read'))).toContain('security invoker');
  });

  it('счётчик сделки НЕ гасится просмотром отдельной задачи', () => {
    /**
     * Прямое требование документа: «просмотр переписки отдельной задачи
     * не отмечает прочитанными сообщения других задач». Отсюда две отметки
     * и разные формулы: `total` смотрит ТОЛЬКО отметку треда, счётчик задачи —
     * позднюю из двух. Подмешай сюда `swm` — и, прочитав одну задачу, человек
     * обнулил бы непрочитанное всей сделки.
     */
    /**
     * С правки 20.09 (п. 4) `total` считается по отдельному CTE `unread` —
     * туда же переехало и условие отметки. Проверяем то же правило по его
     * НОВОМУ месту: основа общего счёта смотрит отметку ТРЕДА и ничего
     * не знает про отметки задач.
     */
    const unreadCte = READ_BODY.slice(
      READ_BODY.indexOf('unread as ('),
      READ_BODY.indexOf('scoped as ('),
    );
    expect(unreadCte).toContain('wm.last_read_at');
    expect(unreadCte, 'основа total смотрит отметку ЗАДАЧИ — просмотр задачи погасит всю сделку')
      .not.toContain('swm');
    // И вторая половина новой формулы: просмотренное поштучно (20.09, п. 4)
    expect(unreadCte).toContain('erp_chat_message_reads');

    const byStage = READ_BODY.slice(READ_BODY.indexOf("'by_stage'"));
    expect(byStage).toContain('greatest(');
    expect(byStage).toContain('swm.last_read_at');
  });

  it('своё сообщение непрочитанным не бывает', () => {
    expect(READ_BODY).toContain('m.author_id is distinct from (select auth.uid())');
  });

  it('отметка прочтения монотонна', () => {
    // Прокрутка ленты вверх — обычное действие; отметка, едущая назад,
    // делала бы уже прочитанное снова непрочитанным
    expect(MARK.match(/greatest\(erp_chat_reads\.last_read_at, excluded\.last_read_at\)/g))
      .toHaveLength(2);
  });

  it('лента сделки включает треды её разработок', () => {
    // «После привязки к сделке переписка разработки доступна из чата сделки
    // БЕЗ копирования сообщений» — это и есть объединение тредов
    expect(PAGE).toContain('join public.erp_experimental e on e.id = t.experimental_id');
    expect(UNREAD).toContain('join public.erp_experimental e on e.id = t.experimental_id');
  });

  it('страница листается ПАРОЙ (момент, id)', () => {
    // `created_at` не уникален: курсор по одному моменту терял бы соседние
    // сообщения, отправленные в ту же миллисекунду
    expect(PAGE).toContain('(m.created_at, m.id)');
  });
});

describe('чат: справочник и права на вызов', () => {
  const DIR = clean(latestDefining('erp_chat_directory'));

  it('справочник definer, но с гейтом участника', () => {
    /**
     * `profiles` виден участнику ТОЛЬКО свой (`profiles_select`), а документ
     * требует поиска сотрудника по имени И email. Значит имена и адреса
     * отдаёт `definer` — и потому гейт обязан быть внутри: без него
     * справочник сотрудников открылся бы любому вошедшему в Order Studio.
     */
    expect(DIR).toContain('security definer');
    expect(DIR).toContain('public.erp_is_member()');
  });

  it('у каждой функции чата отозван public и явно выдан authenticated', () => {
    // `revoke … from anon` в одиночку не делает НИЧЕГО: право приходит
    // от PUBLIC, и `anon` его наследует (правило проекта)
    const grants = clean(latestDefining('erp_chat_send'));
    for (const fn of ['erp_chat_directory', 'erp_chat_send', 'erp_chat_page',
      'erp_chat_unread', 'erp_chat_mark_read']) {
      expect(grants, `${fn}: нет отзыва у public`)
        .toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon`));
      expect(grants, `${fn}: не выдан authenticated — PostgREST его не покажет`)
        .toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`));
    }
  });
});

describe('чат: файлы сообщений', () => {
  it('вид chat не попадает в сводную DELETE-политику вложений', () => {
    /**
     * Удаления сообщений нет — значит и удаления их файлов быть не должно:
     * иначе в переписке остался бы разговор о файле, которого больше нет.
     * Это решение, и оно проверяется, а не подразумевается.
     */
    const del = clean(latestMatching(
      /create policy erp_order_attachments_delete/,
      'сводную DELETE-политику вложений',
    ));
    const policy = del.slice(del.indexOf('create policy erp_order_attachments_delete'));
    expect(policy.slice(0, policy.indexOf(';'))).not.toContain("'chat'");
  });

  it('файл сообщения заводит тот же оператор, что и сообщение', () => {
    // Файл, загруженный в бакет и не привязанный к строке, — «ничей»:
    // его уберёт `storage-gc`, и человек увидит пустое место в переписке
    expect(SEND_BODY).toContain('insert into public.erp_order_attachments');
    expect(SEND_BODY).toContain("'chat'");
  });

  it('message_id есть в схеме и обнуляем', () => {
    expect(columnTypesOf('erp_order_attachments').get('message_id')?.nullable).toBe(true);
    expect(columnTypesOf('erp_notifications').get('message_id')?.nullable).toBe(true);
  });
});
