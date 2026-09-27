// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { functionBody, latestDefining, withoutComments, withoutJsComments } from './migrations.testutil';

/**
 * ОБЩИЙ ГЕЙТ ЗАВЕРШЕНИЯ — И НА ПРЯМОМ ПЕРЕХОДЕ В `done` (правки 27.09, пп. 2, 3, 7).
 *
 * `erp_stage_completion_block` звали только две RPC; кнопка, канбан и чип
 * плана писали `status = 'done'` мимо сервера. Здесь сторожится, что триггер
 * стоит, зовёт гейт с `p_final`, пропускает метки транзакции и service role,
 * а ветки гейта идут в одном порядке с клиентом и одними словами.
 */
const GATE = withoutComments(functionBody(latestDefining('erp_stage_done_gate'), 'erp_stage_done_gate'));
const BLOCK_SQL = latestDefining('erp_stage_completion_block');
const BLOCK = withoutComments(functionBody(BLOCK_SQL, 'erp_stage_completion_block'));
const PROGRAM = withoutComments(functionBody(latestDefining('erp_stage_program_block'), 'erp_stage_program_block'));
const SRC = (rel: string) => withoutJsComments(readFileSync(join(process.cwd(), 'src/erp', rel), 'utf8'));

describe('триггер erp_stage_done_gate', () => {
  it('стоит на переходе статуса и зовёт гейт как закрытие', () => {
    expect(latestDefining('erp_stage_done_gate'))
      .toMatch(/create trigger erp_item_stages_done_gate\s+before update of status on public\.erp_item_stages/);
    expect(GATE).toMatch(/new\.status = 'done' and old\.status is distinct from 'done'/);
    expect(GATE).toMatch(/erp_stage_completion_block\(\s*new\.id,[\s\S]*?true\)/);
    expect(GATE).toMatch(/raise exception/);
  });

  it('пропускает service role и все метки транзакции — у них свои проверки', () => {
    expect(GATE).toMatch(/\(select auth\.uid\(\)\) is null then\s+return new/);
    for (const flag of ['erp.force_complete', 'erp.moving', 'erp.subcontract_rollup', 'erp.supply_autoclose']) {
      expect(GATE, `метка ${flag} не пропускается`).toContain(`current_setting('${flag}', true)`);
    }
  });
});

describe('erp_stage_completion_block — ветки в порядке клиента', () => {
  it('прежняя сигнатура снята — иначе вызов с двумя аргументами неоднозначен', () => {
    expect(BLOCK_SQL).toContain('drop function if exists public.erp_stage_completion_block(uuid, int);');
    expect(BLOCK_SQL).toMatch(/p_final boolean default false/);
  });

  it('программа → (final) рулоны → (final) не учтено → закупка', () => {
    const at = (needle: string) => {
      const i = BLOCK.indexOf(needle);
      expect(i, `нет ветки: ${needle}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const program = at('erp_stage_program_block(p_stage_id)');
    const rolls = at('erp_stage_rolls_fate_block(p_stage_id)');
    const unacc = at('erp_stage_unaccounted(p_stage_id, p_added_good, 0)');
    const supply = at("'Закупка не завершена: '");
    expect(program).toBeLessThan(rolls);
    expect(rolls).toBeLessThan(unacc);
    expect(unacc).toBeLessThan(supply);
    // Рулоны и остаток — только при закрытии, частичная сдача законна
    expect(BLOCK).toMatch(/if p_final then[\s\S]*erp_stage_rolls_fate_block[\s\S]*erp_stage_unaccounted/);
    // Не учтено — только у ПРОИЗВОДСТВЕННОГО участка с формой и не у файлового результата
    expect(BLOCK).toMatch(/is_production, false\)[\s\S]*?jsonb_array_length\(v_stage\.result_fields\) > 0[\s\S]*?result_kind is null/);
  });

  it('слова совпадают с клиентом', () => {
    expect(BLOCK_SQL).toContain('Нельзя завершить этап: не учтено изделий — ');
    expect(SRC('utils/stageRemaining.ts')).toContain('Нельзя завершить этап: не учтено изделий — ');
    const program = 'Сначала завершите задачу “Разработка программы вышивки”';
    expect(PROGRAM).toContain(program);
    expect(SRC('utils/stageResult.ts')).toContain(program);
  });

  it('клиентский порядок тот же: файл → программа → тираж → закупка/рулоны', () => {
    const gates = SRC('store/slices/stageGates.ts');
    const file = gates.indexOf('stageResultFileBlock(');
    const program = gates.indexOf('embroideryProgramBlock(');
    const qty = gates.indexOf('< item.qty');
    const rest = gates.indexOf('stageCompletionBlock(');
    expect(file).toBeGreaterThan(0);
    expect(file).toBeLessThan(program);
    expect(program).toBeLessThan(qty);
    expect(qty).toBeLessThan(rest);
  });
});

describe('программа вышивки — та же позиция и участок', () => {
  it('сервер сравнивает item_id и department_id, пропущенная программа не держит', () => {
    expect(PROGRAM).toMatch(/p\.item_id = s\.item_id/);
    expect(PROGRAM).toMatch(/p\.department_id = s\.department_id/);
    expect(PROGRAM).toMatch(/p\.status not in \('done', 'skipped'\)/);
    expect(PROGRAM).toMatch(/s\.result_kind is null/);
  });

  it('обе RPC не закрывают этап при незавершённой программе, но факт пишут', () => {
    const submit = withoutComments(functionBody(latestDefining('erp_stage_submit_report'), 'erp_stage_submit_report'));
    const progress = withoutComments(functionBody(latestDefining('erp_stage_report_progress'), 'erp_stage_report_progress'));
    expect(submit).toMatch(/and public\.erp_stage_program_block\(p_stage_id\) is null\s+then 'done'/);
    expect(progress).toMatch(/and public\.erp_stage_program_block\(p_stage_id\) is null\s+then 'done'/);
    // Отказа целиком по программе в RPC нет — сдача записывается
    expect(submit).not.toMatch(/erp_stage_program_block[\s\S]{0,80}raise exception/);
  });
});
