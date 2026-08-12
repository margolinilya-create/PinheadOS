import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  functionBody, latestDefining, latestMatching, migration, withoutComments,
} from './migrations.testutil';
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

const SQL = migration('20260803160000_erp_permissions_server_side.sql');
/** Настройки производства: таблица заводится один раз, политики — вместе с ней */
const SETTINGS_SQL = latestMatching(
  /create table if not exists public\.erp_settings/, 'таблицу erp_settings');
const ADMIN_SCREEN = readFileSync(
  join(process.cwd(), 'src/erp/screens/AdminScreen.jsx'), 'utf8');
const STAGE_SQL = latestDefining('erp_stage_guard');
const ORDER_SQL = latestDefining('erp_order_guard');
/**
 * Страж ПОЗИЦИИ читается отдельно.
 *
 * Раньше оба стража жили в одной миграции, и тест брал их из `ORDER_SQL`.
 * Стоило пересоздать один из них отдельным файлом — и проверка второго стала
 * искать его текст не там, где он есть. Каждый страж читается из СВОЕЙ
 * последней миграции, это то же правило, что и в `migrations.testutil`.
 */
const ORDER_ITEM_SQL = latestDefining('erp_order_item_guard');
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

  /**
   * Мощность производства (правки 10.08) — часть планирования, а не отдельная
   * сущность: своего права ей не завели, чтобы оно ничего не выключало сверх
   * `plan.manage`. Раз право одно, оно обязано совпасть в трёх местах —
   * политика записи, вкладка админки и матрица; иначе получится ровно то
   * «кнопка есть, действие падает», от которого сторожит весь этот файл.
   */
  it('мощность производства правится тем же правом, что и план', () => {
    const sql = withoutComments(SETTINGS_SQL);
    expect(sql).toMatch(/erp_settings_insert[\s\S]*erp_has_permission\('plan\.manage'\)/);
    expect(sql).toMatch(/erp_settings_update[\s\S]*erp_has_permission\('plan\.manage'\)/);
    // Читают ВСЕ участники: загрузку видит цех, а не только тот, кто её правит
    expect(sql).toMatch(/erp_settings_read[\s\S]*erp_is_member\(\)/);
    // DELETE не открыт никому — настройка перезаписывается, а не удаляется
    expect(sql).not.toMatch(/erp_settings.*for delete/);
    // И та же проверка в интерфейсе
    expect(ADMIN_SCREEN).toMatch(/id: 'capacity'[\s\S]{0,80}needs: 'plan\.manage'/);
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
    expect(STAGE_SQL).toMatch(/not \(v_complete or v_progress or v_moving\)/);
  });

  it('возврат брака переоткрывает этапы, поэтому defect пускает в in_progress и waiting', () => {
    expect(STAGE_SQL).toMatch(/not \(v_take or v_moving or v_defect\)/);
    expect(STAGE_SQL).toMatch(/not \(v_defect or v_moving\)/);
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
    /**
     * Пропуск теперь `v_moving` = право переноса И метка `erp.moving`, которую
     * ставит только сам перенос. Раньше стояло голое `v_move`, и право работало
     * сквозным пропуском: менеджер (ему перенос выдали 10.08, а take/progress/
     * complete/defect — нет) закрывал прямым запросом любой этап любого цеха.
     */
    expect(STAGE_SQL).toMatch(/not v_moving and not public\.erp_can_act_in_dept\(old\.department_id\)/);
    expect(STAGE_SQL).toMatch(/v_moving :=[\s\S]{0,80}erp\.moving[\s\S]{0,40}and v_move/);
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
 * Страж заказа (миграция 20260803280000) закрывает R1/R2 аудита 03.08.2026:
 * `erp_orders` и `erp_order_items` стояли на `erp_is_member()` без разбора
 * колонок, то есть рабочий цеха мог через REST переписать срок клиента.
 *
 * Тест сторожит не сам SQL, а СОВПАДЕНИЕ его с интерфейсом: страж строже
 * клиента — это «кнопка есть, действие падает»; мягче — дыра.
 */
describe('страж заказа совпадает с интерфейсом', () => {
  const ORDER_CARD = readFileSync(
    join(process.cwd(), 'src/erp/screens/OrderCard.jsx'), 'utf8');
  const ORDER_DRAWER = readFileSync(
    join(process.cwd(), 'src/erp/screens/orderCard/OrderDrawer.jsx'), 'utf8');
  const ORDERS_SCREEN = readFileSync(
    join(process.cwd(), 'src/erp/screens/OrdersScreen.jsx'), 'utf8');

  it('поля заказа требуют order.manage на сервере', () => {
    expect(ORDER_SQL).toMatch(/erp_has_permission\('order\.manage'\)/);
    expect(ORDER_SQL).toMatch(/правка полей заказа требует права order\.manage/);
  });

  it('те же поля гейтятся тем же правом в обеих карточках', () => {
    for (const src of [ORDER_CARD, ORDER_DRAWER]) {
      expect(src).toMatch(/can\('order\.manage'\)/);
      // Каждое поле, которое сторожит SQL, обязано быть отключаемым в разметке
      expect(src.match(/disabled=\{!canManageOrder\}/g) ?? []).toHaveLength(5);
    }
  });

  it('колонки, которые сторожит SQL, — это те же поля, что правит карточка', () => {
    for (const field of ['customer', 'manager', 'launch_date', 'due_date', 'notes']) {
      expect(ORDER_SQL).toMatch(new RegExp(`new\\.${field}\\s+is distinct from old\\.${field}`));
      expect(ORDER_CARD + ORDER_DRAWER).toContain(`saveOrderField({ ${field}:`);
    }
  });

  /**
   * Здесь стоял тест «отгрузка НЕ гейтится ни там, ни там» с оговоркой:
   * «отдельного права на отгрузку в матрице нет… если однажды право заведут,
   * этот тест обязан упасть и напомнить про обе стороны». Он сработал ровно
   * так, как был задуман: 10.08 появилось `warehouse.manage`, и договорённость
   * перестала быть верной.
   *
   * Отдельного права `order.ship` по-прежнему нет и не нужно: отгрузку делает
   * склад с карточки упаковки, закрывает заказ менеджер — обоим уже есть чем
   * гейтить, а третье право ничего бы не выключило.
   */
  it('отгрузка гейтится С ОБЕИХ сторон', () => {
    expect(ORDER_SQL).toMatch(/new\.shipped_status\s+is distinct from/);
    expect(ORDER_SQL).toMatch(/new\.status\s+is distinct from old\.status/);
    expect(ORDER_SQL).toMatch(/warehouse\.manage/);
    // Кнопка «Отгрузить» в списке заказов — под тем же правом
    expect(ORDERS_SCREEN).toMatch(/canShip/);
    expect(ORDERS_SCREEN).toMatch(/can\('warehouse\.manage'\)/);
    // Третьего права не заводили: см. комментарий выше
    expect(ERP_PERMISSIONS).not.toContain('order.ship');
  });

  /**
   * Страж требует `is_admin()` — значит и КНОПКА пометки под `isAdmin`.
   * Прежняя версия теста проверяла `access.isPrivileged && (`, но это выражение
   * в файле встречается дважды и означает РАЗНОЕ: фильтр списка «показывать
   * тестовые» (ничего не пишет) и саму пометку. Совпадение с первым делало
   * проверку зелёной независимо от второго.
   */
  it('пометка «тестовый» — админская с обеих сторон', () => {
    expect(ORDER_SQL).toMatch(/is_demo is distinct from old\.is_demo and not public\.is_admin\(\)/);
    expect(ORDERS_SCREEN).toMatch(/onToggleDemo=\{access\.isAdmin \? onToggleDemo : undefined\}/);
    expect(ORDERS_SCREEN).not.toMatch(/onToggleDemo=\{access\.isPrivileged/);
  });

  /**
   * ИСПРАВЛЕНО 12.08. Тест назывался «клиент сведён к admin/director, как
   * в политике» и проверял `access.isPrivileged` — а это
   * `FULL_ACCESS_PROFILE_ROLES`, то есть admin + director + РОП, тогда как
   * политика `erp_orders_delete` стоит на `is_admin()`. Сторож своим именем
   * утверждал совпадение, а телом закреплял расхождение.
   *
   * Полная проверка обеих сторон (плюс «0 строк ≠ успех» и уборка файлов) —
   * в `orderDeleteGate.test.ts`; здесь остаётся пара «страж ↔ кнопка».
   */
  it('удаление заказа: клиент сведён к admin, как в политике', () => {
    expect(ORDERS_SCREEN).toMatch(/const canDelete = access\.isAdmin;/);
    expect(ORDERS_SCREEN).not.toMatch(/const canDelete = access\.isPrivileged;/);
  });

  it('позиции заказа: клиент туда не пишет, сервер требует order.manage', () => {
    expect(ORDER_ITEM_SQL).toMatch(/erp_order_item_guard/);
    expect(ORDER_ITEM_SQL).toMatch(/правка позиции заказа требует права order\.manage/);
  });

  it('страж пропускает service_role — починка через SQL не должна запираться', () => {
    expect(ORDER_SQL).toMatch(/auth\.uid\(\)\) is null/);
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

/**
 * ТЗ в PDF: гейт интерфейса и гейт сервера — про одно и то же право.
 *
 * До 10.08.2026 они расходились. Кнопка загрузки гейтилась правом `tz.manage`
 * из матрицы, а политика на `erp_tz_documents` — отдельной функцией
 * `erp_can_manage_tz()`, которая смотрела только `profiles.role` и про цеховые
 * роли не знала. Диспетчер видел кнопку, файл улетал в бакет, строка падала
 * с 42501, код убирал файл за собой и писал «Файл загружен, но не привязан
 * к заказу» — то самое «кнопка есть, действие падает», которое правила проекта
 * запрещают. Сторожим совпадение, а не текст сообщения.
 */
describe('ТЗ: сервер гейтит тем же правом, что интерфейс', () => {
  const TZ_INSERT_SQL = latestMatching(
    /create policy "erp_tz_documents_insert"/, 'политику erp_tz_documents_insert');
  const TZ_UPDATE_SQL = latestMatching(
    /create policy "erp_tz_documents_update"/, 'политику erp_tz_documents_update');

  it('загрузка документа требует tz.manage', () => {
    expect(TZ_INSERT_SQL).toMatch(/erp_has_permission\('tz\.manage'\)/);
  });

  it('замена версии требует того же права', () => {
    expect(TZ_UPDATE_SQL).toMatch(/erp_has_permission\('tz\.manage'\)/);
  });

  it('право живёт в матрице, а не в отдельной функции по profiles.role', () => {
    // Прежний предикат `erp_can_manage_tz()` перечислял роли профиля списком —
    // второй источник правды рядом с матрицей.
    //
    // Сверяем ИСПОЛНЯЕМЫЙ SQL, а не файл целиком: комментарий миграции объясняет,
    // от чего ушли, и содержит то же имя — по всему тексту утверждение
    // «этого здесь нет» ловило бы объяснение вместо правила. Тот же урок, ради
    // которого в этом файле живёт `functionBody`.
    expect(withoutComments(TZ_INSERT_SQL)).not.toMatch(/erp_can_manage_tz\(\)/);
    expect(withoutComments(TZ_UPDATE_SQL)).not.toMatch(/erp_can_manage_tz\(\)/);
    expect(ERP_PERMISSIONS).toContain('tz.manage');
  });

  it('те, кто мог грузить ТЗ раньше, могут и теперь', () => {
    // admin/director → director, rop → dispatcher, manager → manager
    for (const role of ['director', 'dispatcher', 'manager'] as const) {
      expect(DEFAULT_PERMISSIONS[role]).toContain('tz.manage');
    }
  });
});

/**
 * Чтение бакета `erp-attachments` клиентом.
 *
 * SELECT-политики на `storage.objects` не было ни одной: публичная раздача идёт
 * мимо RLS, поэтому отсутствие никто не замечал, а клиентские `upsert`, `remove`
 * и `list` тихо вели себя не так, как ожидает код. Отсюда старый комментарий
 * «удалять его клиенту политика не даёт» и сироты в бакете.
 */
describe('бакет вложений: клиент видит объекты', () => {
  const ATT_READ_SQL = latestMatching(
    /create policy "erp_att_read"/, 'политику erp_att_read');

  it('чтение открыто участникам ERP', () => {
    expect(ATT_READ_SQL).toMatch(/for select to authenticated/);
    expect(ATT_READ_SQL).toMatch(/bucket_id = 'erp-attachments' and public\.erp_is_member\(\)/);
  });
});

/**
 * Пропуск этапа — аварийный выход для застрявшего маршрута (правки 10.08).
 *
 * До этой правки переход в `skipped` не подпадал ни под одну ветку стража и
 * проходил БЕЗ проверки прав: любой участник ERP с любым правом на этапы мог
 * объявить чужое задание пройденным. Тест сторожит и наличие правила, и его
 * совпадение с клиентским гейтом кнопки.
 */
describe('пропуск этапа: клиент и сервер требуют одного права', () => {
  const SKIP_SQL = latestDefining('erp_stage_guard');

  it('страж требует order.manage на переход в skipped', () => {
    const body = functionBody(SKIP_SQL, 'erp_stage_guard');
    expect(body).toMatch(/elsif new\.status = 'skipped' then/);
    expect(body).toMatch(/пропуск этапа требует права order\.manage/);
  });

  it('перенос между цехами пропуск не ломает', () => {
    // Перенос закрывает исходный этап, и запрет здесь сделал бы сервер строже
    // интерфейса — тот самый отказ, который страж обязан не порождать
    const body = functionBody(SKIP_SQL, 'erp_stage_guard');
    const branch = body.slice(body.indexOf("elsif new.status = 'skipped'"));
    expect(branch).toMatch(/erp_has_permission\('order\.manage'\) or v_moving/);
  });

  it('кнопка в интерфейсе гейтится тем же правом', () => {
    const hook = readFileSync(
      join(process.cwd(), 'src/erp/store/useStagePermissions.ts'), 'utf8',
    );
    expect(hook).toMatch(/skip = access\.can\('order\.manage'\)/);
  });
});

/**
 * Аварийное снятие блокировок (правки 10.08).
 *
 * Механика опасная по определению — она отключает проверки, — поэтому её
 * серверная сторона сторожится наравне с правами: читать может любой участник
 * (цех обязан видеть, что проверка снята), а снимать и возвращать — только
 * с правом `bypass.manage`. Удаления нет ни у кого: журнал снятий и есть то,
 * по чему завтра будут разбирать, почему заказ прошёл мимо проверки.
 */
describe('аварийные отключения: сервер гейтит тем же правом, что интерфейс', () => {
  const BYPASS_SQL = latestMatching(
    /create table if not exists public\.erp_bypasses/, 'таблицу erp_bypasses');

  it('снятие и возврат требуют bypass.manage', () => {
    const sql = withoutComments(BYPASS_SQL);
    expect(sql).toMatch(/erp_bypasses_insert[\s\S]*erp_has_permission\('bypass\.manage'\)/);
    expect(sql).toMatch(/erp_bypasses_update[\s\S]*erp_has_permission\('bypass\.manage'\)/);
  });

  it('читают все участники ERP — цех должен видеть снятую проверку', () => {
    expect(withoutComments(BYPASS_SQL))
      .toMatch(/erp_bypasses_read[\s\S]*for select to authenticated using \(public\.erp_is_member\(\)\)/);
  });

  it('удаления нет ни у кого: журнал не переписывается', () => {
    expect(withoutComments(BYPASS_SQL)).not.toMatch(/create policy[^\n]*erp_bypasses[^\n]*for delete/);
  });

  it('клиент гейтит экран тем же правом', () => {
    const admin = readFileSync(join(process.cwd(), 'src/erp/screens/AdminScreen.jsx'), 'utf8');
    expect(admin).toMatch(/needs: 'bypass\.manage'/);
  });

  it('право есть в матрице и по умолчанию только у директора', () => {
    expect(ERP_PERMISSIONS).toContain('bypass.manage');
    expect(DEFAULT_PERMISSIONS.director).toContain('bypass.manage');
    for (const role of ['production_head', 'dispatcher', 'manager', 'foreman', 'worker'] as const) {
      expect(DEFAULT_PERMISSIONS[role], `${role} не должен снимать блокировки`)
        .not.toContain('bypass.manage');
    }
  });
});

/**
 * Порядок веток статуса в страже — не стиль, а правило доступа.
 *
 * Цепочка if/elsif проверяет условия ПО ПОРЯДКУ, и ветка `old.status = 'blocked'`
 * («снятие блокировки», право `stage.block`) стояла ВЫШЕ ветки `skipped`
 * (право `order.manage`). Пропуск ЗАБЛОКИРОВАННОГО этапа попадал в первую
 * и проходил по `stage.block`: рабочий блокировал собственное задание, объявлял
 * его пройденным — и все зависимые этапы открывались.
 *
 * Ошибка не видна ни в одном тесте на права: каждая ветка по отдельности
 * написана верно. Видна только их ОЧЕРЁДНОСТЬ, её и сторожим.
 */
describe('порядок веток статуса в erp_stage_guard', () => {
  const GUARD = withoutComments(
    functionBody(latestDefining('erp_stage_guard'), 'erp_stage_guard'),
  );
  const order = [...GUARD.matchAll(/(?:if|elsif) (new\.status = '\w+'|old\.status = 'blocked')/g)]
    .map((m) => m[1]);

  const at = (branch: string) => order.indexOf(branch);

  it('ветки разбираются', () => {
    expect(order.length).toBeGreaterThanOrEqual(5);
  });

  it('skipped проверяется РАНЬШЕ «был заблокирован»', () => {
    // Иначе пропуск заблокированного этапа проходит по stage.block
    expect(at("new.status = 'skipped'")).toBeGreaterThanOrEqual(0);
    expect(at("new.status = 'skipped'")).toBeLessThan(at("old.status = 'blocked'"));
  });

  it('waiting проверяется ПОЗЖЕ «был заблокирован»', () => {
    // Иначе снятие блокировки (blocked → waiting) потребует stage.defect,
    // и цех перестанет разблокировать собственные задания
    expect(at("new.status = 'waiting'")).toBeGreaterThan(at("old.status = 'blocked'"));
  });

  it('пропуск этапа требует order.manage', () => {
    expect(GUARD).toMatch(/erp_has_permission\('order\.manage'\) or v_moving[\s\S]{0,120}пропуск этапа/);
  });
});

/**
 * Отгрузка заказа — самое дорогое необратимое действие: заказ закрывается
 * и уходит в архив. Колонки `status`/`shipped_*` не охранялись стражем ВООБЩЕ,
 * а политика UPDATE открыта любому участнику ERP.
 *
 * Хуже обычной дыры тем, что проверка готовности живёт только в клиенте:
 * прямой запрос обходил и её, и всю машинерию аварийного снятия (право
 * `bypass.manage`, обязательная причина, запись в `erp_bypasses`). То есть
 * существовал бесшумный путь вокруг механизма, заведённого ровно для этого.
 */
describe('страж заказа охраняет отгрузку', () => {
  const GUARD = withoutComments(
    functionBody(latestDefining('erp_order_guard'), 'erp_order_guard'),
  );

  it.each(['status', 'shipped_status', 'shipped_at', 'shipped_by'])(
    'колонка %s входит в проверку',
    (col) => {
      expect(GUARD).toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    },
  );

  it('отгрузка требует права склада ИЛИ права на заказ', () => {
    expect(GUARD).toMatch(/warehouse\.manage/);
    expect(GUARD).toMatch(/order\.manage/);
  });

  it('прежние правила стража не потеряны', () => {
    // Пересоздание функции целиком уже теряло колонки — сторожим и это
    expect(GUARD).toMatch(/new\.due_date/);
    expect(GUARD).toMatch(/new\.manager/);
    expect(GUARD).toMatch(/is_demo/);
  });
});
