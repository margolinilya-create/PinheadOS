import { describe, it, expect } from 'vitest';
import { intermediateReopened, defectRollbackWarning } from './stageDefect';

const names = new Map([
  ['d-cut', 'Закрой'],
  ['d-print', 'Печать'],
  ['d-sew', 'Швейка'],
  ['d-vto', 'ВТО'],
]);

const stages = [
  { id: 's1', department_id: 'd-cut', sort_order: 10, status: 'done' },
  { id: 's2', department_id: 'd-print', sort_order: 20, status: 'done' },
  { id: 's3', department_id: 'd-sew', sort_order: 30, status: 'done' },
  { id: 's4', department_id: 'd-vto', sort_order: 40, status: 'in_progress' },
];
const at = (id: string) => stages.find((s) => s.id === id);

describe('intermediateReopened', () => {
  it('возврат с ВТО в Закрой переоткрывает Печать и Швейку', () => {
    const mids = intermediateReopened({
      stage: at('s4'), targetStage: at('s1'), allStages: stages,
    });
    expect(mids.map((m) => m.id)).toEqual(['s2', 's3']);
  });

  it('соседний этап — промежуточных нет', () => {
    expect(intermediateReopened({
      stage: at('s4'), targetStage: at('s3'), allStages: stages,
    })).toEqual([]);
  });

  it('спец-цель (закупка/подрядчик/текущий) ничего не откатывает', () => {
    expect(intermediateReopened({
      stage: at('s4'), targetStage: null, allStages: stages,
    })).toEqual([]);
  });

  it('не начатые промежуточные этапы не трогаются', () => {
    const withWaiting = stages.map((s) => (s.id === 's3' ? { ...s, status: 'waiting' } : s));
    const mids = intermediateReopened({
      stage: at('s4'), targetStage: at('s1'), allStages: withWaiting,
    });
    expect(mids.map((m) => m.id)).toEqual(['s2']);
  });
});

describe('defectRollbackWarning', () => {
  it('называет количество, цель и все промежуточные цеха', () => {
    const msg = defectRollbackWarning({
      stage: at('s4'), targetStage: at('s1'), allStages: stages,
      deptNameById: names, qty: 30,
    });
    expect(msg).toContain('30 шт');
    expect(msg).toContain('«Закрой»');
    expect(msg).toContain('Печать, Швейка');
  });

  it('без промежуточных — только цель, без обещания лишнего', () => {
    const msg = defectRollbackWarning({
      stage: at('s4'), targetStage: at('s3'), allStages: stages,
      deptNameById: names, qty: 5,
    });
    expect(msg).toContain('«Швейка»');
    expect(msg).not.toContain('переоткроются');
  });

  it('спец-цель не спрашивает', () => {
    expect(defectRollbackWarning({
      stage: at('s4'), targetStage: null, allStages: stages, deptNameById: names, qty: 5,
    })).toBeNull();
  });
});
