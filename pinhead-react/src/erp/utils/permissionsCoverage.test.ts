import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefining, latestMatching } from './migrations.testutil';
import { ERP_PERMISSIONS, ERP_PERMISSION_LABELS, EMPLOYEE_ROLE_LABELS } from '../types';
import { DEFAULT_PERMISSIONS } from './permissions';
import type { EmployeeRole } from '../types';

/**
 * Сторож против декоративных прав.
 *
 * Правило проекта: «все права матрицы обязаны что-то выключать. Добавили право —
 * сразу проведите его до элемента интерфейса, иначе матрица снова станет
 * декоративной». Правило записано словами, а слова протухают молча — здесь оно
 * становится проверяемым.
 *
 * Каждое право обязано:
 *  1. быть засеяно миграцией (иначе на сервере его нет вовсе, а `erp_has_permission`
 *     на отсутствующую строку отвечает «запрещено»);
 *  2. что-то гейтить в коде (иначе галочка в админке ничего не меняет);
 *  3. иметь подпись на русском (иначе в матрице пустая ячейка);
 *  4. присутствовать в DEFAULT_PERMISSIONS хотя бы у одной роли (иначе при неудачной
 *     загрузке матрицы право пропадает у всех).
 */

const SRC = join(process.cwd(), 'src');
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');

function readAll(dir: string, ext: string[], skip: RegExp): string {
  let out = '';
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out += readAll(full, ext, skip);
    } else if (ext.some((e) => entry.endsWith(e)) && !skip.test(entry)) {
      out += readFileSync(full, 'utf8');
    }
  }
  return out;
}

/** Исходники приложения без тестов: право должно гейтить экран, а не тест */
const APP_SOURCE = readAll(SRC, ['.ts', '.tsx', '.js', '.jsx'], /\.test\.[jt]sx?$/);
const ALL_SQL = readAll(MIGRATIONS, ['.sql'], /^$/);

/** Места, где право объявляется, а не применяется — их не считаем гейтом */
const DECLARATIONS = [
  /export type ErpPermission[\s\S]*?;/,
  /export const ERP_PERMISSIONS[\s\S]*?\];/,
  /export const ERP_PERMISSION_LABELS[\s\S]*?\};/,
  /export const DEFAULT_PERMISSIONS[\s\S]*?\n\};/,
];
const USAGE_SOURCE = DECLARATIONS.reduce((acc, re) => acc.replace(re, ''), APP_SOURCE);

describe('право не бывает декоративным', () => {
  it.each(ERP_PERMISSIONS)('%s засеяно миграцией', (permission) => {
    expect(ALL_SQL).toContain(`'${permission}'`);
  });

  it.each(ERP_PERMISSIONS)('%s что-то выключает в коде', (permission) => {
    // Ищем применение: can('право'), canDo('право', …), erp_has_permission('право')
    expect(USAGE_SOURCE).toContain(`'${permission}'`);
  });

  it.each(ERP_PERMISSIONS)('%s имеет подпись на русском', (permission) => {
    const label = ERP_PERMISSION_LABELS[permission];
    expect(label, `нет подписи у ${permission}`).toBeTruthy();
    expect(label).toMatch(/[а-яА-Я]/);
  });

  it.each(ERP_PERMISSIONS)('%s есть хотя бы у одной роли по умолчанию', (permission) => {
    const roles = Object.keys(DEFAULT_PERMISSIONS) as EmployeeRole[];
    expect(roles.some((r) => DEFAULT_PERMISSIONS[r].includes(permission))).toBe(true);
  });
});

describe('роли согласованы между собой', () => {
  it('у каждой роли есть дефолты и непустая подпись', () => {
    for (const role of Object.keys(EMPLOYEE_ROLE_LABELS) as EmployeeRole[]) {
      expect(DEFAULT_PERMISSIONS[role], `нет дефолтов у роли ${role}`).toBeDefined();
      // Кириллицу не требуем: «HR» — законная подпись роли на русском интерфейсе
      expect(EMPLOYEE_ROLE_LABELS[role].trim().length).toBeGreaterThan(1);
    }
  });

  it('каждая роль заведена в CHECK-констрейнте erp_employees', () => {
    // Иначе роль есть в интерфейсе, но строка сотрудника с ней не сохраняется
    for (const role of Object.keys(EMPLOYEE_ROLE_LABELS)) {
      expect(ALL_SQL).toContain(`'${role}'`);
    }
  });

  it('каждая роль — колонка матрицы прав в админке', () => {
    const matrix = readFileSync(join(SRC, 'erp/screens/admin/PermissionsTab.jsx'), 'utf8');
    for (const role of Object.keys(EMPLOYEE_ROLE_LABELS)) {
      expect(matrix, `роли ${role} нет в матрице админки`).toContain(`'${role}'`);
    }
  });

  it('дефолты не выдают прав роли, которой их не даёт seed миграции', () => {
    // Кадры не занимаются производством ни при каком стечении обстоятельств
    expect(DEFAULT_PERMISSIONS.hr).toEqual([]);
  });
});

/**
 * Новичок заводится БЕЗ ПРАВ.
 *
 * До 14.08 `handle_new_user` создавал только профиль с `role = 'manager'`.
 * Строки в `erp_employees` не было, поэтому `erp_role_of_caller()` уходил
 * в запасной путь «роль профиля → цеховая роль» и отдавал `manager` — пять
 * прав, включая правку любого заказа и перенос этапов между цехами. И всё это
 * по ВСЕЙ фабрике: ограничение по цеху на человека без цеха не действует
 * (`canActInDept` там fail-open, и это осознанно — цеха нет у менеджера
 * и снабжения). Одна галочка «Подтвердить» в админке выдавала весь набор.
 *
 * Сторож держит обе половины правила: роль без прав существует И её ставит
 * триггер регистрации. Половина правила молча бесполезна — роль, которую никто
 * не назначает, не защищает никого.
 */
describe('регистрация не выдаёт прав вместе с одобрением', () => {
  const NEW_EMPLOYEE_ROLE = 'pending';

  it('у роли новичка нет ни одного права по умолчанию', () => {
    expect(DEFAULT_PERMISSIONS[NEW_EMPLOYEE_ROLE]).toEqual([]);
  });

  it('матрица в базе тоже не даёт ей прав', () => {
    /**
     * Ищем ПО САМОЙ СТРОКЕ seed'а, а не по «где-то рядом есть слово pending»:
     * первая версия этой проверки цеплялась за любую миграцию, где после
     * `insert into erp_role_permissions` встречается 'pending', и уже на
     * следующей миграции стала читать не тот файл.
     */
    const seed = latestMatching(
      new RegExp(`select '${NEW_EMPLOYEE_ROLE}', [\\w.]+, false`),
      `seed матрицы для роли ${NEW_EMPLOYEE_ROLE}`,
    );
    expect(seed).toContain('erp_role_permissions');
  });

  it('триггер регистрации ставит именно её', () => {
    const trigger = latestDefining('handle_new_user');
    expect(trigger).toContain('insert into public.erp_employees');
    expect(trigger).toContain(`'${NEW_EMPLOYEE_ROLE}'`);
  });

  /**
   * Индекс `erp_employees_profile_uniq` частичный (`where profile_id is not null`),
   * а Postgres выводит целевой индекс из списка колонок ON CONFLICT: без предиката
   * он не находит его и падает с 42P10 ещё при планировании — то есть регистрация
   * перестала бы работать вовсе, а не «иногда».
   */
  it('вставка сотрудника указывает предикат частичного индекса', () => {
    expect(latestDefining('handle_new_user')).toContain(
      'on conflict (profile_id) where profile_id is not null',
    );
  });

  it('колонка роли новичка в матрице админки не редактируется', () => {
    const matrix = readFileSync(join(SRC, 'erp/screens/admin/PermissionsTab.jsx'), 'utf8');
    // Одна галочка здесь раздала бы право всем неназначенным разом
    expect(matrix).toMatch(new RegExp(`LOCKED_ROLES[\\s\\S]*?${NEW_EMPLOYEE_ROLE}:`));
  });
});

/**
 * Решения заказчика 10.08 по матрице — закреплены поимённо.
 *
 * Прежний сторож назывался «дефолты не выдают прав, которых не даёт seed», но
 * проверял ровно одну строку (`hr` пуст). Правку `catalog.edit` у руководителя
 * производства он бы не заметил — а именно такие тихие расхождения между
 * запасными значениями и базой дают отказ прав ровно тогда, когда матрица
 * не загрузилась, то есть в худший момент.
 *
 * Здесь перечислено то, что заказчик решил явно. Менять — вместе с ответом
 * заказчика, а не потому, что «выглядит логичнее».
 */
describe('решения заказчика по матрице (10.08)', () => {
  const WAREHOUSE_ROLES: EmployeeRole[] = [
    'director', 'production_head', 'storekeeper', 'purchaser',
  ];

  it('«Вести склад» — ровно у четырёх ролей', () => {
    const holders = (Object.keys(DEFAULT_PERMISSIONS) as EmployeeRole[])
      .filter((r) => DEFAULT_PERMISSIONS[r].includes('warehouse.manage'));
    expect([...holders].sort()).toEqual([...WAREHOUSE_ROLES].sort());
  });

  it('диспетчеру склад НЕ даётся', () => {
    // Он распоряжается очередью цехов, а не физическим движением товара
    expect(DEFAULT_PERMISSIONS.dispatcher).not.toContain('warehouse.manage');
  });

  it('менеджер переносит задания между цехами', () => {
    // Решение заказчика: заказ ведёт менеджер, перенос он делает сам.
    // Побочный эффект назван вслух: он влияет на загрузку без ведома диспетчера.
    expect(DEFAULT_PERMISSIONS.manager).toContain('stage.move_department');
  });

  it('руководитель производства правит справочники', () => {
    // На боевой базе было включено; заказчик подтвердил, что это его правка,
    // и запасные значения приведены К БАЗЕ, а не наоборот.
    expect(DEFAULT_PERMISSIONS.production_head).toContain('catalog.edit');
  });

  it('закупщик закрывает свой этап, кладовщик — нет (12.08)', () => {
    /**
     * «Закупка» — обычный этап маршрута, и без `stage.complete` закупщик
     * получал 42501 от стража на СВОЁМ этапе: ветка `new.status = 'done'`
     * требует `v_complete or v_progress`, а у роли стояли только
     * `material.receive`, `warehouse.manage` и `stage.block`.
     *
     * Кладовщику то же самое НЕ даётся: этапа в маршруте у склада нет,
     * его задачи гейтятся `warehouse.manage`. Право, которое ничего
     * не открывает, — та самая декоративность.
     */
    expect(DEFAULT_PERMISSIONS.purchaser).toContain('stage.complete');
    expect(DEFAULT_PERMISSIONS.purchaser).toContain('stage.take');
    expect(DEFAULT_PERMISSIONS.storekeeper).not.toContain('stage.complete');

    // Результат в штуках закупка не выпускает, брак не оформляет
    expect(DEFAULT_PERMISSIONS.purchaser).not.toContain('stage.progress');
    expect(DEFAULT_PERMISSIONS.purchaser).not.toContain('stage.defect');
  });

  it('права закупщика проставлены миграцией, а не только в дефолтах', () => {
    // Дефолты работают, лишь пока матрица не загрузилась; на сервере
    // источник правды — таблица, и расхождение даёт «кнопка есть, 42501»
    expect(ALL_SQL).toMatch(
      /erp_role_permissions[\s\S]{0,400}'purchaser'[\s\S]{0,300}'stage\.complete'/,
    );
  });

  it('разработку ЗАВОДИТ тот, кто создаёт заказ-образец (12.08)', () => {
    /**
     * `createOrder` заводит разработку сразу после заказа-образца, а заказы
     * создают менеджер и диспетчер — `experimental.manage` у них нет.
     * INSERT падал 42501 МОЛЧА (ошибка гасится тостом, заказ уже создан),
     * и заказ-образец оставался без разработки: 15 из 21 на боевой базе.
     *
     * Тот же приём, что у складских задач: INSERT под двумя правами, потому
     * что запись создаёт не тот, кто с ней потом работает. Все остальные
     * действия остаются под `experimental.manage`.
     */
    const policy = latestMatching(
      /create policy erp_experimental_insert/,
      'политика вставки разработки',
    );
    expect(policy).toMatch(
      /create policy erp_experimental_insert[\s\S]{0,300}erp_has_permission\('order\.manage'\)/,
    );
    expect(policy).toMatch(/erp_has_permission\('experimental\.manage'\)/);
  });

  it('складское право засеяно в матрице', () => {
    /**
     * Ищем ФАКТ засева по всем миграциям, а не «в последней, где право
     * упомянуто»: последней стала политика журнала склада, и такой тест
     * сломался бы от каждого нового использования права — он сторожил бы
     * порядок файлов вместо смысла.
     */
    expect(ALL_SQL).toMatch(
      /insert into public\.erp_role_permissions[\s\S]{0,400}'warehouse\.manage'/,
    );
  });
});

/**
 * Серверные стражи разбирают изменение по колонкам. Если стор начнёт писать
 * колонку, которой в страже нет, право на неё молча перестанет проверяться —
 * ровно тот способ, которым дыры и возвращаются.
 */
describe('стражи покрывают колонки, которые пишет стор', () => {
  const stageSlice = readFileSync(join(SRC, 'erp/store/slices/stagesSlice.ts'), 'utf8');
  /**
   * Действующая версия стража — ПОСЛЕДНЯЯ миграция, которая его пересоздаёт.
   *
   * Здесь стояло имя файла, и сторож разошёлся с базой ровно тем способом,
   * от которого сам же и защищает: страж пересоздан в 20260805120000 и дополнен
   * в 20260810150000, а тест читал 20260803230000 — то есть сторожил текст,
   * которого БД не исполняет. `serverPermissions` эту ошибку уже пережил,
   * поэтому правило теперь общее (см. migrations.testutil).
   */
  const stageGuard = latestDefining('erp_stage_guard');

  /** Колонки этапа, которые страж намеренно НЕ охраняет (с объяснением в миграции) */
  const UNGUARDED = ['updated_at', 'created_at', 'id'];

  /** Плановые даты: своё право (`order.manage`) и своя проверка вне `v_guarded` */
  const PLANNED = ['planned_start', 'planned_end'];

  /**
   * Проверять «колонка упомянута где-то в файле» недостаточно: страж выходит
   * РАНЬШЕ всех проверок, если изменение не задело ни одной колонки из списка
   * `v_guarded`. Убери колонку только оттуда — правило ниже останется в коде,
   * но исполняться перестанет. Мутационная проверка это и показала, поэтому
   * сверяемся именно со списком `v_guarded`.
   */
  const GUARDED_BLOCK = stageGuard.match(/v_guarded :=[\s\S]*?;/)?.[0] ?? '';

  it('список v_guarded в страже не пуст и разбирается', () => {
    expect(GUARDED_BLOCK).toContain('new.status');
  });

  it('каждая колонка erp_item_stages из стора либо охраняется, либо явно исключена', () => {
    // Патчи стора — литералы вида `qty_done: …` внутри Partial<ErpItemStage>
    const written = new Set<string>();
    for (const m of stageSlice.matchAll(/^\s{4,}(\w+):\s/gm)) written.add(m[1]);

    const stageColumns = [
      'status', 'qty_done', 'qty_rework', 'queue_position', 'department_id',
      'assignee', 'block_reason', 'started_at', 'finished_at',
      'overdue_ack_at', 'overdue_comment', 'planned_start', 'planned_end',
    ];
    for (const col of stageColumns) {
      if (!written.has(col)) continue;
      if (UNGUARDED.includes(col)) {
        expect(GUARDED_BLOCK, `колонка ${col} не должна охраняться`).not.toContain(`new.${col}`);
      } else if (PLANNED.includes(col)) {
        // Плановые даты проверяются ОТДЕЛЬНО и ДО `v_guarded`: изменение одних
        // только дат в этот список не входит и вернулось бы из стража раньше.
        expect(GUARDED_BLOCK, `${col} не должна быть в v_guarded`).not.toContain(`new.${col}`);
        expect(stageGuard, `${col} не охраняется вовсе`).toContain(`new.${col} is distinct`);
      } else {
        expect(GUARDED_BLOCK, `колонка ${col} не входит в v_guarded`).toContain(`new.${col}`);
      }
    }
  });

  it('плановые даты этапа гейтятся order.manage — и на сервере, и в интерфейсе', () => {
    // Разошедшиеся стороны дают худший отказ: «поле правится, а сервер 42501».
    // Гейт в PlanCell появился вместе с этой проверкой, поэтому сверяем обе.
    const planCell = readFileSync(
      join(SRC, 'erp/screens/orderCard/PlanCell.jsx'), 'utf8',
    );
    expect(planCell).toContain("can('order.manage')");
    expect(stageGuard).toMatch(
      /planned_start[\s\S]{0,200}erp_has_permission\('order\.manage'\)/,
    );
  });

  it('страж плана охраняет плановые колонки и не трогает колонки факта', () => {
    const planGuard = latestDefining('erp_calendar_guard');
    for (const col of ['qty_planned', 'work_date', 'priority', 'sort_order', 'comment']) {
      expect(planGuard).toContain(`new.${col}`);
    }
    for (const col of ['qty_done', 'qty_defect', 'fact_comment', 'problem_type']) {
      expect(planGuard).not.toContain(`new.${col} `);
    }
  });

  /**
   * Страж материалов проводит границу «приёмка склада ↔ работа снабжения».
   * Приёмка снимает материальный гейт цеха, поэтому требует `material.receive`;
   * закупочные поля правит снабжение и правом не гейтятся ни в интерфейсе,
   * ни здесь — иначе страж стал бы строже кнопки.
   */
  it('страж материалов охраняет приёмку и не трогает закупочные поля', () => {
    // По имени функции, а не по имени файла: сегодня страж материалов
    // пересоздавался один раз, но правило общее — файл может устареть завтра
    const matGuard = latestDefining('erp_material_guard');
    expect(matGuard).toContain("erp_has_permission('material.receive')");

    // Всё, что записывает приёмку или снимает гейт
    for (const col of [
      'accept_status', 'accepted_at', 'accepted_by', 'accept_comment',
      'qty_received', 'fact_name', 'fact_color', 'fact_article',
    ]) {
      expect(matGuard, `колонка ${col} не охраняется`).toContain(`new.${col}`);
    }
    // «Доступен со склада» снимает гейт минуя приёмку — тоже под правом
    expect(matGuard).toMatch(/new\.status\s*=\s*'reserved'/);

    // Работа снабжения остаётся свободной
    for (const col of ['eta_date', 'supplier', 'article', 'qty_expected', 'responsible', 'notes']) {
      expect(matGuard, `закупочная колонка ${col} не должна охраняться`)
        .not.toContain(`new.${col} is distinct`);
    }
  });

  /**
   * Страж, запертый для service_role, превращает починку через SQL в тупик:
   * RLS он и так минует, а триггер — нет. Правило записано в CLAUDE.md,
   * и все три стража обязаны его соблюдать.
   */
  /**
   * Функция-триггер не должна быть вызываема через REST. Новая функция получает
   * EXECUTE для public по умолчанию, и следующая такая приедет в публичный API
   * молча — advisor утонет в предупреждениях, за которыми теряются настоящие.
   *
   * Это НЕ противоречит правилу «не чинить `is_admin()`/`erp_is_member()`»:
   * те стоят в предикатах RLS и исполняются от лица вызывающего, отзыв сломал бы
   * политики. Триггеры зовёт движок, и EXECUTE при срабатывании не проверяется.
   */
  it('каждая функция-триггер лишена EXECUTE у anon и authenticated', () => {
    /**
     * Отзыв ищем во ВСЕХ миграциях, а не в одной.
     *
     * Раньше тест читал только `20260803250000_erp_revoke_trigger_functions.sql`,
     * то есть требовал, чтобы отзыв для новой функции дописывали в УЖЕ
     * ПРИМЕНЁННУЮ миграцию. Правка применённой миграции — это правка истории:
     * у тех, кто её уже накатил, она не выполнится повторно. Новый страж должен
     * отзывать EXECUTE у себя же, рядом с созданием, и тест обязан это принимать.
     */
    const allSql = readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith('.sql'))
      .map((n) => readFileSync(join(MIGRATIONS, n), 'utf8'));
    const revokeSql = allSql.join('\n');
    const triggerFns = new Set<string>();
    for (const sql of allSql) {
      for (const m of sql.matchAll(/execute function public\.(\w+)\(/g)) {
        triggerFns.add(m[1]);
      }
    }
    expect(triggerFns.size).toBeGreaterThanOrEqual(4);
    for (const fn of triggerFns) {
      expect(revokeSql, `${fn} остаётся вызываемой через REST`)
        .toMatch(new RegExp(`revoke execute on function public\\.${fn}\\(`));
    }
  });

  it('каждый страж пропускает service_role (пустой auth.uid)', () => {
    const guards = [
      '20260803160000_erp_permissions_server_side.sql',
      '20260803180000_erp_stage_guard.sql',
      '20260803220000_erp_material_guard.sql',
    ];
    for (const file of guards) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      expect(sql, `${file}: нет обхода для service_role`)
        .toMatch(/\(select auth\.uid\(\)\) is null then\s+return new/);
    }
  });
});

/**
 * Запись, ставшая переходом, обязана спрашивать право.
 *
 * Заказчик подтвердил, что журналы открыты любому участнику, и для ЭТАПОВ это
 * так и осталось: строка с якорем `stage_id` ничего не решает, а счётчики этапа
 * проверяет `erp_stage_guard`. Но складская строка с 10.08 закрывает приёмку
 * готовой продукции по накопленной сумме, а закрытая приёмка открывает
 * упаковку — то есть запись в журнал стала производственным переходом
 * и обходила `warehouse.manage`, введённое тем же днём.
 */
describe('складская строка журнала гейтится, этапная — нет', () => {
  const POLICY = latestMatching(
    /create policy "erp_stage_reports_insert"/,
    'политика вставки в erp_stage_reports',
  );

  it('разделение проведено по ЯКОРЮ строки', () => {
    expect(POLICY).toMatch(/warehouse_task_id is not null/);
  });

  it('складская строка требует warehouse.manage', () => {
    expect(POLICY).toMatch(/warehouse_task_id is not null then[\s\S]{0,80}'warehouse\.manage'/);
  });

  it('этапная строка остаётся открытой участнику', () => {
    expect(POLICY).toMatch(/else[\s\S]{0,40}erp_is_member\(\)/);
  });

  it('RPC склада называет отказ своим именем', () => {
    // Иначе 42501 придёт из политики соседней таблицы, и цех не поймёт, чего не хватает
    const rpc = latestDefining('erp_warehouse_submit_report');
    expect(rpc).toMatch(/erp_has_permission\('warehouse\.manage'\)/);
    expect(rpc).toMatch(/требует права warehouse\.manage/);
  });
});
