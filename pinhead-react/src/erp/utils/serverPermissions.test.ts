import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PERMISSIONS, canActInDept, resolveErpRole } from './permissions';
import { ERP_PERMISSIONS } from '../types';

/**
 * Матрица прав применяется в ДВУХ местах: в React (`resolveErpRole` + `isAllowed`)
 * и на сервере (`erp_role_of_caller()` + `erp_has_permission()` в миграции
 * 20260803160000). Расхождение этих реализаций даёт худший вид отказа —
 * «в интерфейсе кнопка есть, а сервер отвечает 42501», и виноватым выглядит цех.
 *
 * Тест читает саму миграцию: SQL из vitest не выполнить, но проверить, что правила
 * резолюции роли записаны одинаково, можно — как сторожевой тест APP_KEYS,
 * который так же читает исходники.
 */

const MIGRATIONS_DIR = join(process.cwd(), '../supabase/migrations');

const migration = (name: string) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

/**
 * Текст ПОСЛЕДНЕЙ миграции, пересоздающей функцию, — то есть той, что реально
 * работает в базе. Читать конкретный файл по имени нельзя: функцию пересоздают
 * целиком, и прежняя миграция остаётся в репозитории со СТАРЫМИ правилами.
 *
 * Так тест и разошёлся с базой. Он читал 20260803180000 и утверждал «плановые
 * даты стражем не охраняются» — верно для того файла и неверно для функции:
 * 20260803230000 уже поставила их под `order.manage`. Сторож молча сторожил
 * не то, что исполняется.
 */
function latestMatching(pattern: RegExp, what: string): string {
  const hit = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => pattern.test(migration(f)));
  if (hit.length === 0) throw new Error(`нет миграции, определяющей ${what}`);
  return migration(hit[hit.length - 1]);
}

const latestDefining = (fn: string) =>
  latestMatching(new RegExp(`create or replace function public\\.${fn}\\(`), `${fn}()`);

/**
 * Тело функции без окружающих комментариев миграции. Нужно там, где проверяется
 * ОТСУТСТВИЕ чего-либо: комментарий, объясняющий, почему правила нет, содержит
 * те же слова, что и правило, и утверждение «этого в функции нет» ловило бы его.
 */
function functionBody(sql: string, fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  if (start < 0) throw new Error(`нет тела ${fn}()`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(open, close);
}

const SQL = migration('20260803160000_erp_permissions_server_side.sql');
const STAGE_SQL = latestDefining('erp_stage_guard');
/** Политика INSERT живёт своей жизнью — её тоже берём из последней миграции */
const STAGE_INSERT_SQL = latestMatching(
  /create policy erp_item_stages_insert/, 'политику erp_item_stages_insert');

describe('серверная резолюция роли повторяет клиентскую', () => {
  it('admin и director профиля приводятся к цеховой роли director', () => {
    expect(resolveErpRole('admin', 'worker')).toBe('director');
    expect(resolveErpRole('director', null)).toBe('director');
    expect(SQL).toMatch(/in \('admin', 'director'\) then 'director'/);
  });

  it('таблица соответствия ролей Order Studio совпадает с SQL', () => {
    const pairs: [string, string][] = [
      ['rop', 'dispatcher'],
      ['manager', 'manager'],
      ['production', 'worker'],
      ['designer', 'worker'],
    ];
    for (const [profileRole, erpRole] of pairs) {
      // Клиент
      expect(resolveErpRole(profileRole, null)).toBe(erpRole);
      // Сервер: та же пара записана в CASE
      expect(SQL).toMatch(new RegExp(`when '${profileRole}' then '${erpRole}'`));
    }
  });

  it('роль из erp_employees важнее таблицы соответствия', () => {
    expect(resolveErpRole('manager', 'foreman')).toBe('foreman');
    expect(SQL).toMatch(/employee_role from me\) is not null then/);
  });

  it('сервер берёт роль только у активного и одобренного профиля', () => {
    // Иначе неодобренный пользователь получил бы права рядового сотрудника цеха
    expect(SQL).toMatch(/p\.active is true and p\.approved is true/);
    expect(SQL).toMatch(/e\.active is true/);
  });
});

describe('серверный гейт плана', () => {
  it('отсутствие права в матрице означает запрет, а не дефолт', () => {
    // На клиенте пустая матрица падает на DEFAULT_PERMISSIONS — это защита от
    // неудачной загрузки. На сервере таблица засеяна миграциями целиком.
    expect(SQL).toMatch(/coalesce\(\(\s*select rp\.allowed/);
    expect(SQL).toMatch(/\), false\)/);
  });

  it('ставить и снимать задачи вправе только plan.manage', () => {
    expect(SQL).toMatch(/erp_calendar_slots_insert[\s\S]*plan\.manage/);
    expect(SQL).toMatch(/снятие задачи из плана требует права plan\.manage/);
  });

  it('страж перечисляет ВСЕ плановые колонки — иначе plan.fact правит план', () => {
    for (const col of [
      'department_id', 'stage_id', 'work_date', 'qty_planned',
      'priority', 'sort_order', 'comment', 'created_by',
    ]) {
      expect(SQL).toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    }
  });

  it('колонки факта и проблемы в стража НЕ входят — их вносит цех', () => {
    for (const col of ['qty_done', 'qty_defect', 'fact_comment', 'deviation_reason', 'problem_type']) {
      expect(SQL).not.toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    }
  });

  it('права плана заведены в матрице прав приложения', () => {
    expect(ERP_PERMISSIONS).toContain('plan.manage');
    expect(ERP_PERMISSIONS).toContain('plan.fact');
    expect(DEFAULT_PERMISSIONS.production_head).toContain('plan.manage');
  });
});

/**
 * Страж этапов (`erp_stage_guard`) — самое опасное место серверных прав: ошибка
 * здесь останавливает цех. Правило одно: страж разрешает ровно то, что разрешает
 * интерфейс. Сервер строже клиента — это «кнопка есть, а действие падает», и
 * виноватым выглядит цех; сервер мягче — дыра.
 *
 * Тест закрепляет соответствие «действие интерфейса → право», чтобы правка
 * стража не разошлась с `useStagePermissions`.
 */
describe('страж этапов повторяет гейты интерфейса', () => {
  it('однозначные действия требуют своего права', () => {
    expect(STAGE_SQL).toMatch(/queue_position is distinct from old\.queue_position and not v_priority/);
    expect(STAGE_SQL).toMatch(/department_id is distinct from old\.department_id and not v_move/);
    expect(STAGE_SQL).toMatch(/qty_rework[\s\S]{0,120}not v_defect/);
  });

  /**
   * `reportProgress` закрывает этап сам, когда факт добрал тираж, — значит права
   * `stage.progress` для перехода в done достаточно, ровно как в интерфейсе.
   * Перенос закрывает исходный этап, отсюда же `move`.
   */
  it('завершение этапа принимает progress и move, а не только complete', () => {
    expect(STAGE_SQL).toMatch(/not \(v_complete or v_progress or v_move\)/);
  });

  it('возврат брака переоткрывает этапы, поэтому defect пускает в in_progress и waiting', () => {
    expect(STAGE_SQL).toMatch(/not \(v_take or v_move or v_defect\)/);
    expect(STAGE_SQL).toMatch(/not \(v_defect or v_move\)/);
  });

  it('блокировка и её снятие — одно право', () => {
    expect(STAGE_SQL).toMatch(/new\.status = 'blocked'[\s\S]{0,160}not v_block/);
    expect(STAGE_SQL).toMatch(/old\.status = 'blocked'[\s\S]{0,160}not v_block/);
  });

  it('без единого права на этапы задание не трогается вовсе', () => {
    expect(STAGE_SQL).toMatch(/if not v_any then/);
  });

  /**
   * Плановые даты — под `order.manage` (колонка «План» в карточке заказа гейтится
   * тем же правом). Но у правила есть ИСКЛЮЧЕНИЕ, без которого цех вставал:
   * форма «Взять в работу» просит план завершения и пишет его тем же действием,
   * что переводит этап в `in_progress`. У ролей `worker`/`foreman` права
   * `order.manage` нет, и каждое взятие задания отвечало 42501 — плановая дата
   * не сохранялась, а вместе с ней переставала считаться просрочка этапа.
   */
  it('плановые даты — под order.manage', () => {
    expect(STAGE_SQL).toMatch(/new\.planned_start is distinct from old\.planned_start/);
    expect(STAGE_SQL).toMatch(/new\.planned_end is distinct from old\.planned_end/);
    expect(STAGE_SQL).toMatch(/плановые даты этапа требуют права order\.manage/);
  });

  it('…но взятие задания в работу пишет план завершения под stage.take', () => {
    // Ровно то, что делает форма: этап уходит в in_progress, дата окончания — его же
    expect(STAGE_SQL).toMatch(/new\.status = 'in_progress'[\s\S]{0,200}erp_has_permission\('stage\.take'\)/);
    // Дату НАЧАЛА исключение не отдаёт: её форма взятия не трогает
    expect(STAGE_SQL).toMatch(/new\.planned_start is not distinct from old\.planned_start/);
    // Роли цеха действительно не имеют order.manage — иначе исключение было бы лишним
    expect(DEFAULT_PERMISSIONS.worker).not.toContain('order.manage');
    expect(DEFAULT_PERMISSIONS.foreman).not.toContain('order.manage');
    expect(DEFAULT_PERMISSIONS.worker).toContain('stage.take');
  });

  /**
   * Вторая половина гейта, которой на сервере не было вовсе: интерфейс проверяет
   * право И цех (`canActIn`), и матрица второго не отменяет — «бригадир швейки
   * не закрывает этапы вышивки». Без этой проверки любой член ERP со `stage.complete`
   * закрывал этап чужого цеха через REST.
   */
  it('чужой цех трогать нельзя — кроме права переноса', () => {
    expect(STAGE_SQL).toMatch(/not v_move and not public\.erp_can_act_in_dept\(old\.department_id\)/);
    expect(STAGE_SQL).toMatch(/задание другого цеха изменить нельзя/);
  });

  it('появление этапов открыто создателю заказа и переносящему задание', () => {
    // erp_create_order — security invoker, то есть исполняется от лица создающего
    expect(STAGE_INSERT_SQL).toMatch(/erp_item_stages_insert[\s\S]*order\.manage[\s\S]*stage\.move_department/);
  });

  it('service_role страж пропускает — иначе не починить данные через SQL', () => {
    expect(STAGE_SQL).toMatch(/auth\.uid\(\)\) is null/);
  });
});

/**
 * `erp_can_act_in_dept` — серверное зеркало `canActInDept`. Расхождение здесь
 * стоит дороже обычного: строже клиента — цех не может сдать работу и виноватым
 * выглядит он; мягче — дыра, ради закрытия которой функция и написана.
 */
describe('принадлежность цеху: клиент и сервер об одном', () => {
  const DEPT_SQL = latestDefining('erp_can_act_in_dept');

  it('руководство работает во всех цехах', () => {
    for (const role of ['admin', 'director', 'rop']) {
      expect(canActInDept(role, 'd-sew', 'd-emb')).toBe(true);
    }
    expect(DEPT_SQL).toMatch(/in \('admin', 'director', 'rop'\) then true/);
  });

  it('без привязки к цеху действовать можно везде (fail-open)', () => {
    // В цехах, где сотрудников ещё не завели, запрет остановил бы производство.
    // Что именно такому пользователю можно, решает матрица прав, а не цех.
    expect(canActInDept('production', null, 'd-emb')).toBe(true);
    expect(DEPT_SQL).toMatch(/my_dept from me\) is null then true/);
  });

  it('привязанный сотрудник — только свой цех', () => {
    expect(canActInDept('production', 'd-sew', 'd-sew')).toBe(true);
    expect(canActInDept('production', 'd-sew', 'd-emb')).toBe(false);
    expect(canActInDept('production', 'd-sew', null)).toBe(false);
    expect(DEPT_SQL).toMatch(/p_dept is not null and \(select my_dept from me\) = p_dept/);
  });

  it('сервер берёт привязку только у активного сотрудника и активного профиля', () => {
    expect(DEPT_SQL).toMatch(/e\.active is true/);
    expect(DEPT_SQL).toMatch(/p\.active is true and p\.approved is true/);
  });

  it('клиентский dev-режим серверного соответствия не имеет', () => {
    // `user.id === 'dev'` — локальный автологин, а не роль: на сервере его нет
    expect(canActInDept('production', 'd-sew', 'd-emb', true)).toBe(true);
    expect(functionBody(DEPT_SQL, 'erp_can_act_in_dept')).not.toMatch(/'dev'/);
  });
});
