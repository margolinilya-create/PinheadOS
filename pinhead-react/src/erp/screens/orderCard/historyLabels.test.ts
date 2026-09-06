import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestMatching, withoutComments } from '../../utils/migrations.testutil';

/**
 * ИСТОРИЯ ЗАКАЗА НЕ ПОКАЗЫВАЕТ СЫРЫХ ИДЕНТИФИКАТОРОВ.
 *
 * До 05.09 `auditValue` переводил пять полей, а `material.status`,
 * `material.accept_status`, `subcontract.*` и `procurement.status` выводились
 * как есть: менеджер читал «ordered → in_transit» и «sent →
 * received_at_pinhead» — английские идентификаторы в русском интерфейсе,
 * 150 записей из 672 на боевой базе. Подписи при этом лежали в `types.ts`
 * всё это время: не хватало не словаря, а его применения.
 *
 * СТОРОЖ ЧИТАЕТ ПОЛЯ ИЗ САМИХ ТРИГГЕРОВ, а не из списка в тесте. Список
 * разошёлся бы с базой в первую же правку — ровно так и появилось
 * расхождение, которое чинится этим коммитом. Добавили колонку в аудит,
 * забыли подпись — тест назовёт поле.
 */

const HISTORY = readFileSync(
  join(process.cwd(), 'src/erp/screens/orderCard/HistorySection.jsx'), 'utf8');

/** Аргументы `erp_log_changes(...)` из последней миграции, создающей триггер */
function auditedFields(trigger: string, prefix: string): string[] {
  const sql = withoutComments(
    latestMatching(new RegExp(`create trigger ${trigger}\\b`), `триггер ${trigger}`),
  );
  const call = new RegExp(
    `create trigger ${trigger}\\b[\\s\\S]*?erp_log_changes\\(([^)]*)\\)`, 'i',
  ).exec(sql);
  if (!call) throw new Error(`не найден вызов erp_log_changes у ${trigger}`);
  const args = [...call[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  // Первые два аргумента — ключ заказа и префикс, остальные это колонки
  return args.slice(2).map((f) => (prefix ? `${prefix}.${f}` : f));
}

/**
 * Поля, чьё значение — свободный текст, число или дата: словарь им не нужен,
 * их печатают как есть (даты — через `AUDIT_DATE_FIELDS`).
 */
const FREE_VALUE = /(_date|_at|_on|qty|qty_\w+|price|note|notes|comment|name|supplier|responsible|assignee|contractor|kind|variant|product_type|department_id|block_reason)$/;

const TRIGGERS: [string, string][] = [
  ['erp_materials_audit', 'material'],
  ['erp_subcontracting_audit', 'subcontract'],
  ['erp_stages_audit', 'stage'],
  ['erp_procurement_audit', 'procurement'],
  ['erp_order_items_audit', 'item'],
];

describe('история заказа говорит по-русски', () => {
  it('у каждого поля аудита есть подпись НАЗВАНИЯ', () => {
    const missing: string[] = [];
    for (const [trigger, prefix] of TRIGGERS) {
      for (const field of auditedFields(trigger, prefix)) {
        if (!HISTORY.includes(`'${field}'`)) missing.push(field);
      }
    }
    expect(missing, `нет подписи поля: ${missing.join(', ')}`).toEqual([]);
  });

  it('у каждого поля-СТАТУСА есть словарь значений', () => {
    const table = /const AUDIT_VALUE_LABELS = \{([\s\S]*?)\n\};/.exec(HISTORY);
    expect(table, 'таблица AUDIT_VALUE_LABELS не найдена').toBeTruthy();
    const mapped = table![1];

    const missing: string[] = [];
    for (const [trigger, prefix] of TRIGGERS) {
      for (const field of auditedFields(trigger, prefix)) {
        if (FREE_VALUE.test(field)) continue;
        const key = field.includes('.') ? `'${field}':` : `${field}:`;
        if (!mapped.includes(key)) missing.push(field);
      }
    }
    expect(missing, `значения показываются сырыми: ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * ГЛАВНОЕ УТВЕРЖДЕНИЕ ЭТОГО ФАЙЛА, и найдено оно мутацией: первая редакция
   * сторожа была ЗЕЛЁНОЙ при триггере, возвращённом на мёртвую колонку.
   * Подпись и словарь у `subcontract.status` есть (legacy-записи их требуют),
   * поэтому проверка «есть ли перевод» пропускала подмену. Живая колонка
   * называется отдельно.
   */
  it('журнал подряда следит за ЖИВОЙ колонкой, а не за @deprecated', () => {
    const watched = auditedFields('erp_subcontracting_audit', 'subcontract');
    expect(watched, 'триггер обязан писать `phase`').toContain('subcontract.phase');
    expect(watched, '`status` помечена @deprecated с 10.08')
      .not.toContain('subcontract.status');
  });

  /**
   * Записи, сделанные ДО перевода триггера на `phase`, лежат в базе в старом
   * словаре и переписываться не будут: история не редактируется задним числом.
   */
  it('legacy-значения подряда тоже переводятся', () => {
    expect(HISTORY).toMatch(/'subcontract\.status':\s*\{\s*\.\.\.SUBCONTRACT_STATUS_LABELS/);
    expect(HISTORY).toContain("'subcontract.phase': SUBCONTRACT_PHASE_LABELS");
  });
});
