// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGING_OPTIONS } from '../screens/labels';
import { packagingKind } from '../api/salesOrders';
import { tzToErpDraft } from './tzToErpDraft';
import { newSalesItem, newSalesOrder } from '../model/factory';

/**
 * Сторож ЗНАЧЕНИЙ упаковки против CHECK ERP. Сторож контракта моста
 * проверяет, что у каждого поля есть источник, но не что значение пройдёт:
 * v4 писал «individual»/«bulk», и `erp_create_order` упал бы на
 * `erp_orders_packaging_check` при первом запуске (ревью 16.10).
 * Списки читаются из миграций — те же, что на бою (сверено 16.10).
 */
const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');
const checkValues = (file: string): string[] => {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  const m = sql.match(/check \(packaging in \(([^)]+)\)\)/);
  if (!m) throw new Error(`CHECK упаковки не найден в ${file}`);
  return m[1].split(',').map((v) => v.trim().replace(/'/g, ''));
};
const ORDER_VALUES = checkValues('20260717150000_erp_tz_fields.sql');
const ITEM_VALUES = checkValues('20260816120000_erp_item_tech_block.sql');

describe('упаковка v4 — значения, которые принимает ERP', () => {
  it('виды в интерфейсе v4 — из CHECK заказа ERP', () => {
    for (const o of PACKAGING_OPTIONS) expect(ORDER_VALUES).toContain(o.key);
  });

  it('прочитанное из базы приводится к видам ERP, включая прежние значения', () => {
    for (const v of ['individual', 'bulk', '', 'мусор', ...ORDER_VALUES]) {
      expect(ORDER_VALUES).toContain(packagingKind(v, 'none'));
      expect(ITEM_VALUES).toContain(packagingKind(v, 'inherit'));
    }
  });

  it('мост отдаёт ERP упаковку, которую пропустит CHECK', () => {
    for (const kind of PACKAGING_OPTIONS.map((o) => o.key)) {
      const order = newSalesOrder({ packaging: kind, items: [newSalesItem({ packaging: 'inherit' }), newSalesItem({ packaging: kind })] });
      const draft = tzToErpDraft(order);
      expect(ORDER_VALUES).toContain(draft.form.packaging);
      for (const it of draft.items) expect(ITEM_VALUES).toContain(it.packaging);
    }
  });
});
