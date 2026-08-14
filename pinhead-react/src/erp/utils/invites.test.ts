import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { functionBody, latestDefining, latestMatching, withoutComments } from './migrations.testutil';
import { inviteUrl, JOIN_PATH } from './invite';

/**
 * Приглашение по ссылке — сторож серверной половины.
 *
 * Проверка кода живёт ТОЛЬКО в триггере регистрации: клиент кладёт код
 * в метаданные `signUp`, то есть присылает его сам и может прислать что угодно.
 * Всё, что делает приглашение приглашением, — срок, одноразовость, привязка
 * к адресу — держится на одном SQL-выражении, и здесь оно закреплено.
 *
 * Тест читает МИГРАЦИИ, а не базу, и берёт ПОСЛЕДНЕЕ определение функции:
 * функции пересоздаются целиком, и прежняя миграция остаётся в репозитории
 * со старыми правилами (правило проекта).
 */

/**
 * Именно ТЕЛО функции, а не файл миграции: в одном файле лежат и триггер,
 * и функция предпросмотра, и утверждение «здесь нет отдельного select»
 * ловило бы соседнюю функцию вместо проверяемой.
 */
const TRIGGER = () => withoutComments(
  functionBody(latestDefining('handle_new_user'), 'handle_new_user'),
);
const PREVIEW = () => withoutComments(
  functionBody(latestDefining('erp_invite_preview'), 'erp_invite_preview'),
);
/** Сигнатура и гранты лежат вне тела */
const PREVIEW_MIGRATION = () => latestDefining('erp_invite_preview');
const TABLE = () => latestMatching(/create table if not exists public\.erp_invites/, 'таблица erp_invites');

describe('гашение кода приглашения', () => {
  /**
   * Двое, открывшие одну ссылку одновременно, не могут оба получить права.
   * Отдельные SELECT и UPDATE такого не гарантируют: между ними успевает
   * вклиниться вторая регистрация, и приглашение сработает дважды.
   */
  it('код гасится и читается ОДНИМ атомарным update … returning', () => {
    const sql = TRIGGER();
    expect(sql).toMatch(/update public\.erp_invites[\s\S]*?set used_at = now\(\)/);
    expect(sql).toMatch(/returning profile_role, employee_role, department_id/);
    // Отдельной выборки быть не должно — она и есть та самая щель
    expect(sql).not.toMatch(/select[\s\S]{0,80}from public\.erp_invites/);
  });

  it('повторно использованный код не срабатывает', () => {
    expect(TRIGGER()).toContain('used_at is null');
  });

  it('отозванный код не срабатывает', () => {
    expect(TRIGGER()).toContain('revoked_at is null');
  });

  it('просроченный код не срабатывает', () => {
    expect(TRIGGER()).toContain('expires_at > now()');
  });

  /**
   * Регистр адреса не должен решать, сработает приглашение или нет:
   * человек введёт `Ivan@`, админ выпишет `ivan@`.
   */
  it('привязка к адресу сравнивается без учёта регистра', () => {
    expect(TRIGGER()).toMatch(/lower\(email\) = lower\(new\.email\)/);
  });

  it('приглашение без адреса действует для любого, кому его дали', () => {
    expect(TRIGGER()).toContain('email is null or');
  });

  /**
   * Код приходит из метаданных, то есть из браузера, и может быть не uuid.
   * Без перехвата исключение свалило бы ВСЮ вставку в auth.users: человек
   * получил бы «Database error saving new user» вместо формы регистрации,
   * причём и тот, кто ни про какие приглашения не знает.
   */
  it('нечитаемый код не ломает регистрацию целиком', () => {
    const sql = TRIGGER();
    expect(sql).toContain('exception when invalid_text_representation');
  });

  /** Приглашение и есть одобрение: админ выдал ссылку конкретному человеку */
  it('пришедший по коду заводится одобренным, пришедший сам — нет', () => {
    const sql = TRIGGER();
    expect(sql).toMatch(/v_approved\s+boolean\s*:=\s*false/);
    expect(sql).toMatch(/v_approved\s*:=\s*true/);
  });

  /** Без приглашения роль остаётся без прав — запасной путь не выдаёт доступ */
  it('без кода цеховая роль остаётся pending', () => {
    expect(TRIGGER()).toMatch(/v_employee_role\s+text\s*:=\s*'pending'/);
  });
});

describe('показ приглашения до входа', () => {
  it('приглашение показывает функция, а не выборка из таблицы', () => {
    // Политика для anon не может ограничить выдачу одной строкой: RLS не видит
    // фильтр запроса, и `for select to anon using (true)` открыл бы всю таблицу
    const table = TABLE();
    expect(table).not.toMatch(/create policy[^;]*erp_invites[^;]*to anon/i);
  });

  it('функция вызывается невошедшим человеком', () => {
    expect(TABLE()).toMatch(/grant execute on function public\.erp_invite_preview\(uuid\) to anon/);
  });

  it('функция не отдаёт сам код', () => {
    const sql = PREVIEW_MIGRATION();
    const returns = sql.slice(sql.indexOf('returns table'), sql.indexOf('language sql'));
    expect(returns).not.toContain('code');
  });

  it('недействительный код отдаёт пусто — теми же тремя условиями', () => {
    const sql = PREVIEW();
    expect(sql).toContain('used_at is null');
    expect(sql).toContain('revoked_at is null');
    expect(sql).toContain('expires_at > now()');
  });
});

describe('доступ к самим приглашениям', () => {
  it('выдача, чтение и отзыв — под правом матрицы, а не ролью учётной записи', () => {
    const sql = TABLE();
    for (const cmd of ['select', 'insert', 'update']) {
      const policy = sql.match(new RegExp(`for ${cmd} to authenticated[\\s\\S]*?;`))?.[0] ?? '';
      expect(policy, `политика ${cmd} не спрашивает право`).toContain(
        "erp_has_permission('staff.invite')",
      );
    }
  });
});

/**
 * Класс в разметке — ещё не стиль.
 *
 * В этом же проекте `#pendingScreen` и все `.pending-*` прожили в App.jsx без
 * единого объявления CSS: экран рисовался системным шрифтом с нативной серой
 * кнопкой, и человек читал это как поломку сайта. Ни один тест на разметку
 * такого не видит — className есть, элемент на месте, всё «работает».
 * У CSS Modules промах ещё тише: `styles.нетТакого` это `undefined`,
 * то есть класс просто не попадает в разметку.
 */
describe('стили модалки приглашения объявлены', () => {
  const CSS = readFileSync(join(process.cwd(), 'src/erp/erp.module.css'), 'utf8');
  const JSX = readFileSync(
    join(process.cwd(), 'src/erp/screens/admin/InviteModal.jsx'), 'utf8',
  );
  const used = [...new Set(
    [...JSX.matchAll(/styles\.([A-Za-z][\w]*)/g)].map((m) => m[1]),
  )];

  it('классы найдены — иначе сторож проверяет пустоту', () => {
    expect(used.length).toBeGreaterThan(5);
  });

  it.each(used)('.%s объявлен в erp.module.css', (cls) => {
    expect(CSS).toMatch(new RegExp(`\\.${cls}[\\s,{:]`));
  });
});

describe('адрес ссылки', () => {
  /**
   * Ссылку собирают в двух местах, а читает её третье. Разойдутся — человек
   * попадёт на форму входа вместо приглашения, то есть ровно туда, откуда
   * приглашения его и уводят.
   */
  it('собирается из одного места', () => {
    expect(inviteUrl('abc', 'https://pinhead-os.vercel.app'))
      .toBe('https://pinhead-os.vercel.app/join?code=abc');
    expect(JOIN_PATH).toBe('/join');
  });
});
