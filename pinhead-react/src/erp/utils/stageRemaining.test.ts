// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  deptAccountsByReports, reportedAccountedBySize, reportedDefect, sizeBreakdownText,
  sizeUnaccounted, stageCeiling, stageDonePatch, stageUnaccounted, stageUnaccountedBlock,
} from './stageRemaining';
import { sizeKey } from './stageSizes';
import { functionBody, latestDefining, withoutComments, withoutJsComments } from './migrations.testutil';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ОСТАТОК ПРИ ЧАСТИЧНОЙ СДАЧЕ (правка заказчика 27.09, п. 7).
 *
 * Пример документа: выкроено и принято в пошив 472 (тираж 350 + плюс), сдано
 * 368 — оставшиеся 104 обязаны остаться на участке, а не исчезнуть.
 */
const cut = { id: 'cut', status: 'done' as const, depends_on: [], qty_done: 472 };
const sew = { id: 'sew', status: 'in_progress' as const, depends_on: ['cut'], qty_done: 368 };
const FORM = { result_fields: [{ code: 'good', label: 'Сшито', target: 'qty_good' as const }] };
const NO_FORM = { result_fields: [] };

describe('stageUnaccounted — формула документа', () => {
  it('принято 472, сдано 368 — не учтено 104, а не 0', () => {
    expect(stageCeiling(sew, [cut, sew], 350)).toBe(472);
    expect(stageUnaccounted({ stage: sew, allStages: [cut, sew], itemQty: 350, defectReported: 0 }))
      .toBe(104);
  });

  it('окончательный брак уменьшает остаток, переделка — нет', () => {
    expect(stageUnaccounted({ stage: sew, allStages: [cut, sew], itemQty: 350, defectReported: 100 }))
      .toBe(4);
    // Переделка в формуле не участвует: она вернётся годной или браком
    const withRework = { ...sew, qty_rework: 50 };
    expect(stageUnaccounted({
      stage: withRework, allStages: [cut, sew], itemQty: 350, defectReported: 100,
    })).toBe(4);
  });

  it('приращения текущей сдачи считаются до отправки', () => {
    expect(stageUnaccounted({
      stage: sew, allStages: [cut, sew], itemQty: 350, defectReported: 0, addedGood: 100, addedDefect: 4,
    })).toBe(0);
  });

  /** Предшественник в работе: вход растёт, закрывать по нему рано */
  it('потолок — большее из тиража и принятого', () => {
    const cutting = { ...cut, status: 'in_progress' as const, qty_done: 100 };
    expect(stageCeiling(sew, [cutting, sew], 350)).toBe(350);
    expect(stageUnaccounted({
      stage: { ...sew, qty_done: 100 }, allStages: [cutting, sew], itemQty: 350, defectReported: 0,
    })).toBe(250);
  });

  it('ниже нуля не уходит', () => {
    expect(stageUnaccounted({
      stage: { ...sew, qty_done: 500 }, allStages: [cut, sew], itemQty: 350, defectReported: 0,
    })).toBe(0);
  });
});

describe('stageUnaccountedBlock — только у участка с формой результата', () => {
  const base = { stage: sew, allStages: [cut, sew], itemQty: 350, defectReported: 0 };

  it('называет число, разбивку и что делать', () => {
    const text = stageUnaccountedBlock({ ...base, dept: FORM, breakdown: 'M — 60 шт, L — 44 шт' });
    expect(text).toBe('Нельзя завершить этап: не учтено 104 изделия (M — 60 шт, L — 44 шт). '
      + 'Сдайте оставшиеся изделия или укажите окончательный брак.');
  });

  it('склоняет: 1 изделие, 5 изделий', () => {
    expect(stageUnaccountedBlock({ ...base, stage: { ...sew, qty_done: 471 }, dept: FORM }))
      .toContain('не учтено 1 изделие.');
    expect(stageUnaccountedBlock({ ...base, stage: { ...sew, qty_done: 467 }, dept: FORM }))
      .toContain('не учтено 5 изделий.');
  });

  it('учтено всё — блока нет', () => {
    expect(stageUnaccountedBlock({ ...base, defectReported: 104, dept: FORM })).toBeNull();
  });

  it('участок без формы результата не гейтится — ему нечем сдать иначе', () => {
    expect(stageUnaccountedBlock({ ...base, dept: NO_FORM })).toBeNull();
    expect(stageUnaccountedBlock({ ...base, dept: null })).toBeNull();
    expect(deptAccountsByReports(FORM)).toBe(true);
    expect(deptAccountsByReports(NO_FORM)).toBe(false);
  });
});

describe('stageDonePatch — что пишет «Завершить этап»', () => {
  it('участок с формой: qty_done не трогается', () => {
    expect(stageDonePatch({ id: 'sew', result_kind: null }, 350, FORM)).toEqual({});
  });
  it('файловый результат: числа нет вовсе', () => {
    expect(stageDonePatch({ id: 'p', result_kind: 'embroidery_program' }, 350, NO_FORM)).toEqual({});
  });
  it('участок без формы: весь тираж, как прежде', () => {
    expect(stageDonePatch({ id: 'vto', result_kind: null }, 350, NO_FORM)).toEqual({ qty_done: 350 });
  });
});

describe('суммы по отчётам', () => {
  const reports = [
    { stage_id: 'sew', qty_defect: 3, sizes: [{ color: '—', size: 'M', qty_good: 10, qty_defect: 3 }] },
    { stage_id: 'sew', qty_defect: 1, sizes: [{ color: '—', size: 'M', qty_good: 5, qty_defect: 1 }, { color: '—', size: 'L', qty_good: 7 }] },
    { stage_id: 'cut', qty_defect: 9, sizes: [] },
  ];

  it('reportedDefect — по этапу, если он назван', () => {
    expect(reportedDefect(reports, 'sew')).toBe(4);
    expect(reportedDefect(reports)).toBe(13);
  });

  it('учтено по размерам — годные плюс брак', () => {
    expect(reportedAccountedBySize(reports, 'sew')).toEqual({
      [sizeKey('—', 'M')]: 19, [sizeKey('—', 'L')]: 7,
    });
  });

  it('sizeUnaccounted и подпись разбивки', () => {
    const left = sizeUnaccounted(
      { [sizeKey('—', 'M')]: 60, [sizeKey('—', 'L')]: 7 },
      reportedAccountedBySize(reports, 'sew'),
    );
    expect(left).toEqual({ [sizeKey('—', 'M')]: 41 });
    expect(sizeBreakdownText(left, new Map([[sizeKey('—', 'M'), 'M']]))).toBe('M — 41 шт');
  });
});

/**
 * СЕРВЕР СЧИТАЕТ ТЕМ ЖЕ ПРАВИЛОМ. Сторож читает миграцию: закрытие этапа
 * в обеих RPC идёт через `erp_stage_unaccounted`, а не через `>= тираж`;
 * потолок по размеру — остаток из принятых, с тем же текстом, что у формы.
 */
describe('серверное зеркало (миграция 27.09, п. 7)', () => {
  const UNACC = withoutComments(functionBody(latestDefining('erp_stage_unaccounted'), 'erp_stage_unaccounted'));
  const SUBMIT = withoutComments(functionBody(latestDefining('erp_stage_submit_report'), 'erp_stage_submit_report'));
  const PROGRESS = withoutComments(functionBody(latestDefining('erp_stage_report_progress'), 'erp_stage_report_progress'));
  const OUTPUT = withoutComments(functionBody(latestDefining('erp_stage_size_output'), 'erp_stage_size_output'));

  it('не учтено = greatest(тираж, принято) − сдано − брак', () => {
    expect(UNACC).toMatch(/greatest\(v_qty, v_input\)/);
    expect(UNACC).toMatch(/erp_stage_input_qty\(p_stage_id\)/);
    expect(UNACC).toMatch(/erp_stage_defect_reported\(p_stage_id\)/);
    // Переделка в формуле не участвует
    expect(UNACC).not.toContain('qty_rework');
  });

  it('обе RPC закрывают этап по учтённому, а не по тиражу', () => {
    expect(SUBMIT).toMatch(/erp_stage_unaccounted\(p_stage_id, v_good, 0\) <= 0\s+then 'done'/);
    expect(SUBMIT).not.toMatch(/>= v_total\s+then 'done'/);
    expect(PROGRESS).toMatch(/erp_stage_unaccounted\(p_stage_id, p_qty, 0\) <= 0/);
    expect(PROGRESS).not.toMatch(/v_next >= v_total then 'done'/);
  });

  it('потолок по размеру — остаток из принятых, текст тот же, что в форме', () => {
    expect(SUBMIT).toMatch(/erp_stage_size_input\(p_stage_id\)/);
    expect(SUBMIT).toMatch(/sum\(z\.qty_good \+ z\.qty_defect\)/);
    const phrase = 'шт сдать нельзя — столько осталось из принятых (введено';
    expect(latestDefining('erp_stage_submit_report')).toContain(phrase);
    expect(withoutJsComments(readFileSync(join(process.cwd(), 'src/erp/utils/stageSizes.ts'), 'utf8')))
      .toContain('шт сдать нельзя — столько осталось');
    // Закрой под потолок не попадает — там рождаются плюсы
    expect(SUBMIT).toMatch(/allows_over_plan/);
  });

  it('размерный выход идёт вверх по графу — зеркало sizeInputFor через нанесение', () => {
    expect(OUTPUT).toMatch(/erp_stage_size_output\(v_dep, p_depth \+ 1\)/);
    expect(OUTPUT).toMatch(/min\(qty\)/);
  });
});
