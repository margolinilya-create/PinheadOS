import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ORDER_SELECT, ORDER_LIST_SELECT } from './orderHelpers';

/**
 * Списочный запрос заказов облегчён (D2 аудита): он не тянет колонки, которые
 * читает только карточка. Замерено на проде — 391 кБ против 351 кБ на 76
 * активных заказах, и разрыв растёт линейно.
 *
 * Опасность правки ровно одна: убрать колонку, которую читает какой-нибудь
 * списочный экран. Тогда поле молча станет `undefined` — не ошибка, не пустой
 * экран, а просто «пропала просрочка в карточке очереди». Поэтому список
 * колонок сверяется с тем, что экраны реально читают.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(p);
  }
  return out;
}

/** Экраны и утилиты, работающие по ВСЕМУ массиву заказов из списочного запроса */
const LIST_CONSUMERS = [
  'erp/utils/queueEntries.js',
  'erp/utils/routes.ts',
  'erp/utils/filterStages.ts',
  'erp/utils/stageUi.ts',
  'erp/utils/deptLoad.ts',
  'erp/utils/progress.ts',
  'erp/utils/tz.ts',
  'erp/store/orderHelpers.ts',
  'erp/components/kanban/KanbanCard.jsx',
  'erp/screens/queue/QueueCard.jsx',
  'erp/screens/queue/QueueRow.jsx',
];

describe('списочный запрос заказов', () => {
  it('полный и списочный select — разные, и списочный берёт колонки поимённо', () => {
    expect(ORDER_LIST_SELECT).not.toBe(ORDER_SELECT);
    /**
     * Смысл списочного запроса — брать у этапов НЕ ВСЁ, а перечисленное:
     * `select *` в PostgREST тянет и NULL-колонки, а этапов в списке сотни.
     *
     * Здесь стояло сравнение ДЛИН строк — прокси, меряющий не то: списочный
     * запрос длиннее ПОТОМУ ЧТО перечисляет колонки, и каждая новая колонка
     * приближала его к произвольному порогу «+400». Проверяем то, что важно:
     * этапы берутся поимённо в списке и звёздочкой в полном.
     */
    expect(ORDER_LIST_SELECT).not.toMatch(/stages:erp_item_stages \(\*\)/);
    expect(ORDER_SELECT).toMatch(/stages:erp_item_stages \(\*\)/);
    // Оба остаются одним деревом: списочный не должен потерять отношения
    for (const rel of [
      'items:erp_order_items', 'stages:erp_item_stages', 'prints:erp_item_prints',
      'materials:erp_materials', 'attachments:erp_order_attachments',
      'procurement_tasks:erp_procurement_tasks', 'warehouse_ops:erp_warehouse_ops',
      'warehouse_tasks:erp_warehouse_tasks', 'tz_documents:erp_tz_documents',
    ]) {
      expect(ORDER_LIST_SELECT, `в списочном нет ${rel}`).toContain(rel);
      expect(ORDER_SELECT, `в полном нет ${rel}`).toContain(rel);
    }
  });

  it('колонки, нужные гейтам и очереди, из списка НЕ убраны', () => {
    // Каждая из них что-то показывает или гейтит в списочных экранах
    for (const col of [
      'status', 'qty_done', 'qty_rework', 'depends_on', 'department_id',
      'planned_start', 'planned_end', 'started_at', 'finished_at',
      'assignee', 'block_reason', 'queue_position', 'sort_order',
      'overdue_comment', 'overdue_ack_at', 'updated_at',
      // Волна 3: цикл прохода и происхождение (образец/серия) — оба
      // показываются в очереди, и без них бейдж «Образец» молча не рисуется
      'cycle', 'origin',
    ]) {
      expect(ORDER_LIST_SELECT, `колонка ${col} нужна списочным экранам`).toContain(col);
    }
  });

  it('убрана размерная сетка — её рисует только карточка', () => {
    expect(ORDER_LIST_SELECT).not.toContain('size_grid');
    expect(ORDER_SELECT).toContain('*'); // полный select её приносит
  });

  /**
   * Сторож против главной ошибки: списочный экран читает поле этапа, которого
   * в лёгком select нет. Ищем обращения вида `stage.X` / `st.X` в файлах,
   * работающих по всему массиву, и требуем колонку в списочном select.
   */
  it('каждое поле этапа, читаемое списочными экранами, есть в списочном select', () => {
    const stageFields = new Set<string>();
    for (const rel of LIST_CONSUMERS) {
      const file = join(SRC, rel);
      let src: string;
      try { src = readFileSync(file, 'utf8'); } catch { continue; }
      for (const m of src.matchAll(/\b(?:stage|st|s)\.([a-z_]{3,})\b/g)) stageFields.add(m[1]);
    }
    // Отсекаем то, что не является колонкой (методы, поля других объектов)
    const COLUMNS = new Set([
      'id', 'item_id', 'department_id', 'depends_on', 'status', 'qty_done', 'qty_rework',
      'planned_start', 'planned_end', 'started_at', 'finished_at', 'assignee',
      'block_reason', 'notes', 'sort_order', 'created_at', 'updated_at',
      'overdue_comment', 'overdue_ack_at', 'queue_position',
    ]);
    const used = [...stageFields].filter((f) => COLUMNS.has(f));
    expect(used.length).toBeGreaterThan(8); // сторож не сторожит пустоту

    for (const col of used) {
      expect(
        ORDER_LIST_SELECT.includes(col),
        `списочные экраны читают stage.${col}, но его нет в ORDER_LIST_SELECT — поле станет undefined молча`,
      ).toBe(true);
    }
  });

  it('walk находит исходники (иначе список потребителей мог протухнуть)', () => {
    expect(walk(join(SRC, 'erp/utils')).length).toBeGreaterThan(10);
    for (const rel of LIST_CONSUMERS) {
      expect(() => readFileSync(join(SRC, rel), 'utf8'), `${rel} не найден`).not.toThrow();
    }
  });
});
