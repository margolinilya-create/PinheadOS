// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { columnsOf } from '../../types/schema.testutil';
import { EMPLOYEE_COLUMNS } from './slices/employeesSlice';
import { NOTIFICATION_COLUMNS } from './slices/notificationsSlice';
import { PLAN_COMMENT_COLUMNS, PLAN_SLOT_COLUMNS } from './slices/planSlice';
import {
  SKU_CARD_COLUMNS,
  SKU_CARD_FILE_COLUMNS,
  SKU_CARD_VERSION_COLUMNS,
} from './slices/skuSlice';

/**
 * Слайсы читают колонки ПОИМЁННО, а не `*` (бэклог обзора 26.09, п. 11).
 *
 * У поимённого списка две опасности, и обе тихие:
 *   · опечатка в имени — PostgREST ответит 400, и экран покажет «не удалось
 *     загрузить» без единой подсказки, какая колонка виновата;
 *   · выпавшая колонка, которую читает экран, — поле приедет `undefined`.
 * Первую ловит сверка со снимком схемы, вторую — список полей, которые
 * экраны читают заведомо (ниже, с адресом читателя).
 */

const SRC = join(process.cwd(), 'src');
const names = (cols: string) => cols.split(',').map((c) => c.trim());

const LISTS: [string, string, string][] = [
  ['EMPLOYEE_COLUMNS', 'erp_employees', EMPLOYEE_COLUMNS],
  ['NOTIFICATION_COLUMNS', 'erp_notifications', NOTIFICATION_COLUMNS],
  ['PLAN_SLOT_COLUMNS', 'erp_calendar_slots', PLAN_SLOT_COLUMNS],
  ['PLAN_COMMENT_COLUMNS', 'erp_plan_comments', PLAN_COMMENT_COLUMNS],
  ['SKU_CARD_COLUMNS', 'erp_sku_cards', SKU_CARD_COLUMNS],
  ['SKU_CARD_VERSION_COLUMNS', 'erp_sku_card_versions', SKU_CARD_VERSION_COLUMNS],
  ['SKU_CARD_FILE_COLUMNS', 'erp_sku_card_files', SKU_CARD_FILE_COLUMNS],
];

describe('поимённые колонки слайсов', () => {
  it.each(LISTS)('%s — только настоящие колонки %s, без звёздочки и повторов', (_, table, cols) => {
    const real = new Set(columnsOf(table));
    expect(real.size, `снимок схемы не знает ${table}`).toBeGreaterThan(0);
    const list = names(cols);
    expect(list).not.toContain('*');
    expect(new Set(list).size).toBe(list.length);
    for (const c of list) expect(real.has(c), `${table}.${c}`).toBe(true);
  });

  it('у каждого списка есть id — по нему строки заменяются и сливаются с realtime', () => {
    for (const [name, , cols] of LISTS) expect(names(cols), name).toContain('id');
  });

  it('в select слайсов не осталось `*`', () => {
    for (const file of ['employeesSlice', 'notificationsSlice', 'planSlice', 'skuSlice']) {
      const src = readFileSync(join(SRC, 'erp/store/slices', `${file}.ts`), 'utf8');
      expect(src, file).not.toMatch(/\.select\(\s*['"`]\*['"`]\s*\)/);
    }
  });

  /**
   * Поля, которые экраны читают заведомо. Колонка, выпавшая из списка, здесь
   * падает с именем читателя — а в интерфейсе стала бы молчаливым `undefined`.
   */
  it.each([
    // Строка сотрудника в админке и выбор цеха/менеджера
    ['EMPLOYEE_COLUMNS', EMPLOYEE_COLUMNS,
      ['full_name', 'role', 'department_id', 'extra_department_ids', 'profile_id', 'notes', 'active']],
    // Колокол и всплывающие: вкладки по виду, переход, гашение по сообщению
    ['NOTIFICATION_COLUMNS', NOTIFICATION_COLUMNS,
      ['kind', 'order_id', 'title', 'body', 'link', 'message_id', 'created_at', 'read_at']],
    // Доска плана, факт и проблема дня (PlanSlotDrawer, planCard, planDay)
    ['PLAN_SLOT_COLUMNS', PLAN_SLOT_COLUMNS,
      ['stage_id', 'work_date', 'qty_planned', 'qty_done', 'qty_defect', 'status', 'fact_by',
        'fact_at', 'sort_order', 'problem_type', 'problem_can_continue']],
    ['PLAN_COMMENT_COLUMNS', PLAN_COMMENT_COLUMNS, ['slot_id', 'author', 'side', 'text', 'created_at']],
    // SkuCardPage: FIELDS + описание — правка сравнивает черновик с card[key]
    ['SKU_CARD_COLUMNS', SKU_CARD_COLUMNS,
      ['code', 'name', 'category', 'fit', 'pattern_tech_name', 'pattern_version', 'price_min',
        'price_max', 'description', 'card_version', 'status', 'experimental_id']],
    ['SKU_CARD_VERSION_COLUMNS', SKU_CARD_VERSION_COLUMNS, ['version', 'changed_fields', 'created_at']],
    ['SKU_CARD_FILE_COLUMNS', SKU_CARD_FILE_COLUMNS,
      ['role', 'file_path', 'file_name', 'version', 'superseded_at']],
  ])('%s несёт поля, которые читают экраны', (_, cols, needed) => {
    const list = new Set(names(cols as string));
    for (const c of needed as string[]) expect(list.has(c), c).toBe(true);
  });

  it('поля описания SkuCardPage все есть в SKU_CARD_COLUMNS', () => {
    const page = readFileSync(join(SRC, 'erp/screens/skuCard/SkuCardPage.jsx'), 'utf8');
    const block = page.match(/const FIELDS = \[([\s\S]*?)\];/);
    expect(block, 'FIELDS не найден — сторож надо перенаправить').not.toBeNull();
    const keys = [...block![1].matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    const list = new Set(names(SKU_CARD_COLUMNS));
    for (const k of keys) expect(list.has(k), k).toBe(true);
  });
});
