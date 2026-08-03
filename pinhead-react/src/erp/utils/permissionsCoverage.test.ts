import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
 * Серверные стражи разбирают изменение по колонкам. Если стор начнёт писать
 * колонку, которой в страже нет, право на неё молча перестанет проверяться —
 * ровно тот способ, которым дыры и возвращаются.
 */
describe('стражи покрывают колонки, которые пишет стор', () => {
  const stageSlice = readFileSync(join(SRC, 'erp/store/slices/stagesSlice.ts'), 'utf8');
  // Действующая версия стража — последняя миграция, которая его пересоздаёт.
  // Читать первую значило бы сторожить текст, который БД уже не исполняет.
  const stageGuard = readFileSync(
    join(MIGRATIONS, '20260803230000_erp_stage_guard_planned_dates.sql'), 'utf8',
  );

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
    const planGuard = readFileSync(
      join(MIGRATIONS, '20260803160000_erp_permissions_server_side.sql'), 'utf8',
    );
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
    const matGuard = readFileSync(
      join(MIGRATIONS, '20260803220000_erp_material_guard.sql'), 'utf8',
    );
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
