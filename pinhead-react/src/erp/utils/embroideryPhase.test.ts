// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { EMBROIDERY_PROGRAM_OPERATION, isProgramPhase, phaseOperation } from './embroideryPhase';
import { PROGRAM_PHASE_BLOCK, stageHeadingId } from './embroideryPhaseText';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ВЫШИВКА ОДНОЙ ЗАДАЧЕЙ (правки 19.10, п. 1; Р1). Фаза — `result_kind`:
 * `embroidery_program` — «Разработка программы вышивки», `null` — «Вышивка».
 * Фаза есть только у ОДИНОЧНОЙ строки: у позиции нет другой строки того же
 * цеха без `result_kind` (старые заказы с парой строк живут по-старому).
 * Зеркало серверной `erp_embroidery_is_phased`.
 */
const program = (extra: Record<string, unknown> = {}) => ({
  id: 'emb', item_id: 'it1', department_id: 'd-emb', result_kind: 'embroidery_program' as const,
  status: 'in_progress' as const, ...extra,
});
const cut = { id: 'cut', item_id: 'it1', department_id: 'd-cut', result_kind: null };

describe('isProgramPhase', () => {
  it('одиночная строка — фаза', () => {
    const p = program();
    expect(isProgramPhase(p, [cut, p])).toBe(true);
  });

  it('старая пара строк — не фаза', () => {
    const p = program();
    const work = { id: 'emb2', item_id: 'it1', department_id: 'd-emb', result_kind: null };
    expect(isProgramPhase(p, [cut, p, work])).toBe(false);
  });

  it('строка вышивки другой позиции фазу не снимает', () => {
    const p = program();
    const foreign = { id: 'x', item_id: 'it2', department_id: 'd-emb', result_kind: null };
    expect(isProgramPhase(p, [cut, p, foreign])).toBe(true);
  });

  it('после перехода (result_kind null) — уже не фаза', () => {
    const p = program({ result_kind: null });
    expect(isProgramPhase(p, [cut, p])).toBe(false);
  });

  it('закрытая программа — наследие, не фаза (как у сервера)', () => {
    for (const status of ['done', 'skipped'] as const) {
      const p = program({ status });
      expect(isProgramPhase(p, [cut, p])).toBe(false);
    }
  });

  it('сервер считает так же: не закрыта, нет отдельной строки без result_kind', () => {
    const sql = readFileSync(
      join(process.cwd(), '../supabase/migrations/20261019100000_erp_embroidery_one_stage.sql'), 'utf8');
    expect(sql).toMatch(/s\.status not in \('done', 'skipped'\)/);
    expect(sql).toMatch(/n\.result_kind is null/);
  });
});

describe('подпись фазы', () => {
  it('в фазе программы — операция «Разработка программы вышивки»', () => {
    expect(phaseOperation({ operation: EMBROIDERY_PROGRAM_OPERATION, result_kind: 'embroidery_program' }))
      .toBe(EMBROIDERY_PROGRAM_OPERATION);
  });

  it('в фазе вышивки старая подпись программы не печатается — задача зовётся цехом', () => {
    expect(phaseOperation({ operation: EMBROIDERY_PROGRAM_OPERATION, result_kind: null })).toBeNull();
    expect(phaseOperation({ operation: null, result_kind: null })).toBeNull();
  });

  it('чужая операция остаётся как есть', () => {
    expect(phaseOperation({ operation: 'Нашивка шеврона', result_kind: null })).toBe('Нашивка шеврона');
  });

  it('текст отказа совпадает с сервером', () => {
    const sql = readFileSync(
      join(process.cwd(), '../supabase/migrations/20261019100000_erp_embroidery_one_stage.sql'), 'utf8');
    expect(sql).toContain(PROGRAM_PHASE_BLOCK);
  });

  it('id заголовка этапа — от id этапа', () => {
    expect(stageHeadingId('s1')).toBe('stage-title-s1');
  });
});
