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
