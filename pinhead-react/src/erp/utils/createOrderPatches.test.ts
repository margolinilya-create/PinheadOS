// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ПРАВКИ ПОДСТАНОВКОЙ НЕ ТЕРЯЮТСЯ ПРИ ПЕРЕСОЗДАНИИ ФУНКЦИИ (ошибка с боя 20.10).
 *
 * Часть функций ERP правилась не полным текстом, а подстановкой в живое
 * определение (`pg_get_functiondef` + `replace`): полного текста с этими
 * правками в миграциях нет. T1 правок 19.10 пересоздал `erp_create_order`
 * по последнему ПОЛНОМУ тексту (07.09) и молча откатил четыре правки —
 * заказ с повторным проходом цеха перестал создаваться (23505
 * `erp_item_stages_item_dept_cycle_key`), программа вышивки создавалась
 * обычной вышивкой. Вернула их `20261020130000_erp_create_order_restore_patches`.
 *
 * Правило: ПОСЛЕДНЯЯ миграция, которая определяет функцию (полным текстом
 * или подстановкой), обязана нести все поля, внесённые подстановками.
 * Новая правка подстановкой — добавить её поля сюда.
 */
const MIGRATIONS_DIR = join(process.cwd(), '..', 'supabase', 'migrations');

const PATCHED: Record<string, string[]> = {
  erp_create_order: ['color_supplier', "'cycle'", 'result_kind', 'sku_card_id'],
  erp_route_apply: ["'cycle'", 'result_kind'],
  erp_update_order: ['sku_card_id'],
  erp_stage_guard: ['result_kind'],
};

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');

/** Полное определение функции: текст от заголовка до конца тела */
function fullDefinition(sql: string, fn: string): string | null {
  const head = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${fn}\\s*\\(`, 'i');
  const m = head.exec(sql);
  if (!m) return null;
  const rest = sql.slice(m.index);
  const tag = /as\s+(\$[a-z_]*\$)/i.exec(rest);
  if (!tag) return rest;
  const start = tag.index + tag[0].length;
  const end = rest.indexOf(tag[1], start);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Правка подстановкой: читает живое определение этой функции */
function isPatch(sql: string, fn: string): boolean {
  return /pg_get_functiondef/i.test(sql) && new RegExp(`proname\\s*=\\s*'${fn}'`).test(sql);
}

describe('правки подстановкой — в последнем определении функции', () => {
  for (const [fn, fields] of Object.entries(PATCHED)) {
    it(`${fn}: последняя миграция несёт ${fields.join(', ')}`, () => {
      let last: { file: string; text: string } | null = null;
      for (const f of files) {
        const sql = read(f);
        const full = fullDefinition(sql, fn);
        if (full) last = { file: f, text: full };
        else if (isPatch(sql, fn)) last = { file: f, text: sql };
      }
      expect(last, `${fn} не найдена в миграциях`).not.toBeNull();
      const missing = fields.filter((t) => !last!.text.includes(t));
      expect(missing, `${last!.file}: нет ${missing.join(', ')} — правка подстановкой потеряна`).toEqual([]);
    });
  }
});
