// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FILES_MANAGE_DELETE_KINDS,
  ORDER_MANAGE_DELETE_KINDS,
  canRemoveOrderAttachment,
} from './attachmentRights';
import { latestMatching, withoutComments } from './migrations.testutil';

/**
 * Клиентский гейт «снять файл заказа» и DELETE-политика — одно правило
 * (правка 01.10, п. 6). Сторож читает ДЕЙСТВУЮЩУЮ политику — последнюю
 * миграцию, которая её создаёт, — и требует, чтобы списки видов под каждым
 * правом совпадали с клиентскими дословно.
 */
const policy = (() => {
  // Политику задаёт `create policy` или (с 01.10) `alter policy … using`
  const sql = withoutComments(latestMatching(
    /(create|alter) policy erp_order_attachments_delete/,
    'DELETE-политику вложений',
  ));
  const from = sql.search(/(create|alter) policy erp_order_attachments_delete/);
  return sql.slice(from, sql.indexOf(';', from));
})();

/** Виды из ветки `kind = any (array[…]) and … erp_has_permission('<право>')` */
function kindsUnder(permission: string): string[] {
  const re = new RegExp(
    String.raw`kind = any \(array\[([^\]]*)\]\)\s*and \(select public\.erp_has_permission\('${permission.replace('.', '\\.')}'\)\)`,
  );
  const block = policy.match(re)?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe('удаление вложения: интерфейс и политика об одном', () => {
  it('виды под files.manage совпадают', () => {
    expect(kindsUnder('files.manage')).toEqual([...FILES_MANAGE_DELETE_KINDS].sort());
  });

  it('виды под order.manage совпадают', () => {
    expect(kindsUnder('order.manage')).toEqual([...ORDER_MANAGE_DELETE_KINDS].sort());
  });

  it('ветка подрядного ТЗ и админ на месте', () => {
    expect(policy).toMatch(/\(select public\.is_admin\(\)\)/);
    expect(policy).toMatch(/stage_id is not null\s+and kind = 'subcontract'\s+and \(select public\.erp_has_permission\('order\.manage'\)\)/);
  });

  it('вызовы функций в предикате обёрнуты в (select …)', () => {
    // Голый вызов исполняется на каждую строку (правило 24.09)
    expect(policy.replace(/\(select public\.[a-z_]+\([^)]*\)\)/g, '')).not.toMatch(/public\.\w+\(/);
  });
});

describe('canRemoveOrderAttachment', () => {
  const rights = (...granted: string[]) => (p: string) => granted.includes(p);

  it('менеджер (order.manage) снимает лист закупки, упаковку и вложения', () => {
    for (const kind of ['purchase_list', 'packaging', 'tech', 'note', 'attachment']) {
      expect(canRemoveOrderAttachment({ kind } as never, rights('order.manage'), false)).toBe(true);
    }
  });

  it('макеты нанесений — только files.manage, не order.manage', () => {
    expect(canRemoveOrderAttachment({ kind: 'print' } as never, rights('order.manage'), false)).toBe(false);
    expect(canRemoveOrderAttachment({ kind: 'print' } as never, rights('files.manage'), false)).toBe(true);
  });

  it('файлы чата и результаты этапа не снимает никто, кроме админа', () => {
    const all = rights('order.manage', 'files.manage', 'tz.manage');
    expect(canRemoveOrderAttachment({ kind: 'chat' } as never, all, false)).toBe(false);
    expect(canRemoveOrderAttachment({ kind: 'stage_result' } as never, all, false)).toBe(false);
    expect(canRemoveOrderAttachment({ kind: 'chat' } as never, rights(), true)).toBe(true);
  });

  it('подрядное ТЗ — order.manage и только при привязке к этапу', () => {
    expect(canRemoveOrderAttachment({ kind: 'subcontract', stage_id: 's-1' } as never, rights('order.manage'), false)).toBe(true);
    expect(canRemoveOrderAttachment({ kind: 'subcontract', stage_id: null } as never, rights('order.manage'), false)).toBe(false);
  });
});
