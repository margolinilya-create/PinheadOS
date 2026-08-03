import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Аудит пишет ТРИГГЕР, а подписывает поля React. Две стороны легко разъезжаются:
 * добавили колонку в триггер — история молча показывает сырое `material.kind`
 * вместо «Материал: вид», и никто этого не замечает, пока не понадобится
 * разобраться, кто сорвал заказ.
 *
 * Поэтому список полей берётся из самой миграции, а не дублируется здесь.
 */

const SRC = join(process.cwd(), 'src');
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');

const AUDIT_SQL = readFileSync(
  join(MIGRATIONS, '20260803240000_erp_audit_by_trigger.sql'), 'utf8',
);
const HISTORY = readFileSync(
  join(SRC, 'erp/screens/orderCard/HistorySection.jsx'), 'utf8',
);

/**
 * Поля из вызовов `erp_log_changes('order_id'|'item_id', 'префикс', 'поле', …)`.
 * Возвращает имена в том виде, в каком они лягут в `field_name`.
 */
function auditedFields(): string[] {
  const out: string[] = [];
  const calls = AUDIT_SQL.matchAll(
    /erp_log_changes\(\s*'(?:order_id|item_id)'\s*,\s*'([^']*)'\s*,([\s\S]*?)\)\s*;/g,
  );
  for (const call of calls) {
    const prefix = call[1];
    for (const f of call[2].matchAll(/'([a-z_]+)'/g)) {
      out.push(prefix === '' ? f[1] : `${prefix}.${f[1]}`);
    }
  }
  return out;
}

const FIELDS = auditedFields();

describe('аудит триггером и подписи в истории не разъезжаются', () => {
  it('вызовы триггера вообще находятся (иначе тест сторожил бы пустоту)', () => {
    expect(FIELDS.length).toBeGreaterThanOrEqual(25);
    expect(FIELDS).toContain('stage.status');
    expect(FIELDS).toContain('material.accept_status');
    expect(FIELDS).toContain('planned_start');
  });

  it.each(FIELDS)('поле «%s» имеет подпись в истории', (field) => {
    expect(
      HISTORY.includes(`'${field}'`) || HISTORY.includes(`${field}:`),
      `нет подписи для ${field} — история покажет сырое имя колонки`,
    ).toBe(true);
  });

  it('пять смежных таблиц накрыты аудитом, а не только этапы', () => {
    // Сверяем именно СОЗДАНИЕ триггера, а не упоминание таблицы: `drop trigger`
    // и комментарий тоже содержат её имя, и проверка на упоминание проходила бы
    // с удалённым триггером. Мутационная проверка это и показала.
    for (const tbl of [
      'erp_item_stages', 'erp_materials', 'erp_order_items',
      'erp_procurement_tasks', 'erp_subcontracting',
    ]) {
      expect(AUDIT_SQL, `${tbl} без триггера аудита`).toMatch(
        new RegExp(`create trigger \\w+\\s+after update on public\\.${tbl}\\b`),
      );
    }
  });

  it('действующее лицо пишется как uuid, а не только именем', () => {
    // Имя рвётся при переименовании и не различает тёзок — опора должна быть id
    expect(AUDIT_SQL).toContain('changed_by_id');
    expect(AUDIT_SQL).toContain('actor_id');
    expect(AUDIT_SQL).toMatch(/v_actor_id\s*:=\s*\(select auth\.uid\(\)\)/);
  });

  it('историю нельзя подделать и нельзя читать до одобрения', () => {
    // Политики стояли `true`: неодобренный читал ленту всех заказов и мог в неё дописать
    const created = AUDIT_SQL.match(/create policy erp_stage_events_\w+[\s\S]*?;/g) ?? [];
    expect(created.length).toBe(2);
    for (const p of created) expect(p).toContain('erp_is_member()');
    expect(AUDIT_SQL).not.toMatch(/create policy erp_stage_events[\s\S]*?\((?:true)\)/);
  });

  it('аудит не роняет работу цеха, если позиция уже удалена', () => {
    // Триггер AFTER UPDATE: исключение здесь откатило бы саму работу
    expect(AUDIT_SQL).toMatch(/if v_order is null then\s+return new;/);
  });
});
