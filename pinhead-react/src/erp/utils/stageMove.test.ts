import { describe, it, expect } from 'vitest';
import { analyzeStageMove, moveConfirmMessage } from './stageMove';
import type { ErpItemStage } from '../types';

const DEPTS = new Map([
  ['cut', 'Закрой'],
  ['emb', 'Вышивка'],
  ['sew', 'Швейка'],
  ['vto', 'ВТО'],
]);

function stage(dept: string, sort: number, over: Partial<ErpItemStage> = {}): ErpItemStage {
  return {
    id: `st-${dept}`, item_id: 'i1', department_id: dept, depends_on: [],
    status: 'waiting', qty_done: 0, qty_rework: 0,
    planned_start: null, planned_end: null, started_at: null, finished_at: null,
    assignee: null, block_reason: null, notes: null, sort_order: sort,
    created_at: '', updated_at: '',
    ...over,
  } as ErpItemStage;
}

const item = (stages: ErpItemStage[], qty = 100) => ({ qty, stages });

const analyze = (
  src: ErpItemStage,
  stages: ErpItemStage[],
  target: string,
  qty = 100,
) => analyzeStageMove({
  stage: src,
  item: item(stages, qty),
  targetDeptId: target,
  targetDeptName: DEPTS.get(target) || target,
  deptNameById: DEPTS,
});

describe('analyzeStageMove — запреты', () => {
  it('перенос в тот же цех запрещён', () => {
    const s = stage('sew', 30);
    const plan = analyze(s, [s], 'sew');
    expect(plan.allowed).toBe(false);
    expect(plan.issues[0].kind).toBe('same_dept');
  });

  it('заблокированное задание переносить нельзя', () => {
    const s = stage('emb', 20, { status: 'blocked', block_reason: 'нет ниток' });
    const plan = analyze(s, [s, stage('sew', 30)], 'sew');
    expect(plan.allowed).toBe(false);
    expect(plan.issues[0].kind).toBe('blocked_source');
  });

  it('перенос в заблокированный цех запрещён', () => {
    const s = stage('emb', 20, { status: 'in_progress' });
    const t = stage('sew', 30, { status: 'blocked' });
    const plan = analyze(s, [s, t], 'sew');
    expect(plan.allowed).toBe(false);
    expect(plan.issues[0].kind).toBe('blocked_target');
  });
});

describe('analyzeStageMove — предупреждения', () => {
  it('обычный перенос вперёд без сюрпризов: только незавершённость', () => {
    const s = stage('emb', 20, { status: 'in_progress', qty_done: 100 });
    const t = stage('sew', 30);
    const plan = analyze(s, [s, t], 'sew');
    expect(plan.allowed).toBe(true);
    expect(plan.targetStage).toBe(t);
    expect(plan.issues).toEqual([]);
    expect(plan.requiresComment).toBe(false);
  });

  it('на этапе сделано не всё — предупреждаем и не требуем комментарий', () => {
    const s = stage('emb', 20, { status: 'in_progress', qty_done: 40 });
    const plan = analyze(s, [s, stage('sew', 30)], 'sew');
    expect(plan.issues.map((i) => i.kind)).toEqual(['unfinished']);
    expect(plan.issues[0].text).toContain('40 из 100');
    expect(plan.requiresComment).toBe(false);
  });

  it('пропуск незавершённых этапов — перечисляем и требуем комментарий', () => {
    const s = stage('cut', 10, { status: 'done', qty_done: 100 });
    const mid = stage('emb', 20);
    const t = stage('vto', 40);
    const plan = analyze(s, [s, mid, stage('sew', 30), t], 'vto');
    const skip = plan.issues.find((i) => i.kind === 'skip');
    expect(skip?.text).toContain('Вышивка');
    expect(skip?.text).toContain('Швейка');
    expect(plan.requiresComment).toBe(true);
  });

  it('уже завершённые промежуточные этапы пропуском не считаются', () => {
    const s = stage('cut', 10, { status: 'done', qty_done: 100 });
    const mid = stage('emb', 20, { status: 'done' });
    const plan = analyze(s, [s, mid, stage('sew', 30)], 'sew');
    expect(plan.issues).toEqual([]);
  });

  it('возврат на предыдущий этап — предупреждение и обязательный комментарий', () => {
    const s = stage('sew', 30, { status: 'in_progress', qty_done: 100 });
    const t = stage('cut', 10, { status: 'done' });
    const plan = analyze(s, [t, s], 'cut');
    expect(plan.issues.map((i) => i.kind)).toEqual(['back']);
    expect(plan.requiresComment).toBe(true);
  });

  it('цеха нет в маршруте — этап будет добавлен', () => {
    const s = stage('cut', 10, { status: 'in_progress', qty_done: 100 });
    const plan = analyze(s, [s], 'emb');
    expect(plan.allowed).toBe(true);
    expect(plan.targetStage).toBeNull();
    expect(plan.issues.map((i) => i.kind)).toEqual(['new_stage']);
    expect(plan.requiresComment).toBe(false);
  });
});

/*
 * Круг образца (`cycle`) — часть ключа этапа с 10.08:
 * unique(item_id, department_id, cycle). Позиция ходит в один цех
 * многократно, и всё, что ищет этап по паре «позиция + цех», обязано брать
 * и круг. Здесь этого не было: `find` по одному `department_id` брал первый
 * попавшийся круг, из-за чего расходились с сервером (`erp_stage_move_department`
 * ищет `cycle = v_stage.cycle`) и текст подтверждения, и проверка
 * «цель заблокирована», и признак возврата назад.
 */
describe('перенос учитывает круг образца (cycle)', () => {
  it('этап другого круга в целевом цехе целью НЕ считается', () => {
    const src = stage('cut', 10, { status: 'in_progress', qty_done: 100, cycle: 1 });
    // В целевом цехе есть этап, но нулевого круга — он к этому переносу не относится
    const otherCycle = stage('sew', 20, { cycle: 0, id: 'st-sew-c0' });
    const plan = analyze(src, [src, otherCycle], 'sew');
    expect(plan.targetStage, 'цель из чужого круга подхватывать нельзя').toBeNull();
    expect(plan.issues.map((i) => i.kind)).toEqual(['new_stage']);
  });

  it('берётся этап СВОЕГО круга, а не первый попавшийся', () => {
    const src = stage('cut', 10, { status: 'in_progress', qty_done: 100, cycle: 1 });
    const wrong = stage('sew', 20, { cycle: 0, id: 'st-sew-c0', status: 'blocked' });
    const right = stage('sew', 20, { cycle: 1, id: 'st-sew-c1' });
    const plan = analyze(src, [src, wrong, right], 'sew');
    expect(plan.targetStage?.id).toBe('st-sew-c1');
    // Заблокированный этап ЧУЖОГО круга не должен запрещать перенос
    expect(plan.allowed).toBe(true);
    expect(plan.issues.map((i) => i.kind)).not.toContain('blocked_target');
  });

  it('серийная позиция без cycle ведёт себя как нулевой круг', () => {
    const src = stage('cut', 10, { status: 'in_progress', qty_done: 100 });
    const target = stage('sew', 20);
    const plan = analyze(src, [src, target], 'sew');
    expect(plan.targetStage?.id).toBe('st-sew');
  });
});

describe('moveConfirmMessage', () => {
  it('главный вопрос + последствия одной строкой', () => {
    const s = stage('emb', 20, { status: 'in_progress', qty_done: 40 });
    const plan = analyze(s, [s, stage('sew', 30)], 'sew');
    const msg = moveConfirmMessage(plan, 'Вышивка', 'Швейка');
    expect(msg).toContain('«Вышивка» будет отмечен завершённым');
    expect(msg).toContain('«Швейка»');
    expect(msg).toContain('40 из 100');
  });
});
