import { describe, it, expect } from 'vitest';
import { intermediateReopened, defectRollbackWarning, descendantStages } from './stageDefect';

const names = new Map([
  ['d-cut', 'Закрой'],
  ['d-print', 'Печать'],
  ['d-sew', 'Швейка'],
  ['d-vto', 'ВТО'],
  ['d-emb', 'Вышивка'],
  ['d-silk', 'Шелкография'],
]);

// Линейный маршрут. `depends_on` заполнен у всех, кроме первого этапа, —
// ровно как в базе (проверено на проде: 443 этапа, без зависимостей только
// 113 первых, по одному на позицию).
const stages = [
  { id: 's1', department_id: 'd-cut', sort_order: 10, status: 'done', depends_on: [] },
  { id: 's2', department_id: 'd-print', sort_order: 20, status: 'done', depends_on: ['s1'] },
  { id: 's3', department_id: 'd-sew', sort_order: 30, status: 'done', depends_on: ['s2'] },
  { id: 's4', department_id: 'd-vto', sort_order: 40, status: 'in_progress', depends_on: ['s3'] },
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

/**
 * Регрессия A3 (аудит 29.07). Ровно тот маршрут, на котором партия уходила
 * в пошив без печати: обе ветки нанесения имеют ОДИНАКОВЫЙ sort_order, и расчёт
 * по интервалу выбрасывал соседнюю ветку отсечкой «строго меньше верхней границы».
 */
describe('параллельные ветки нанесения (A3)', () => {
  //           ┌─ вышивка(30) ─┐
  // закрой(20)┤               ├─ швейка(40) → ВТО(50)
  //           └─ шелко(30) ───┘
  const parallel = [
    { id: 'p-cut', department_id: 'd-cut', sort_order: 20, status: 'done', depends_on: [] },
    { id: 'p-emb', department_id: 'd-emb', sort_order: 30, status: 'in_progress', depends_on: ['p-cut'] },
    { id: 'p-silk', department_id: 'd-silk', sort_order: 30, status: 'done', depends_on: ['p-cut'] },
    { id: 'p-sew', department_id: 'd-sew', sort_order: 40, status: 'waiting', depends_on: ['p-emb', 'p-silk'] },
    { id: 'p-vto', department_id: 'd-vto', sort_order: 50, status: 'waiting', depends_on: ['p-sew'] },
  ];

  it('возврат из вышивки в закрой переоткрывает СОСЕДНЮЮ ветку — шелкографию', () => {
    const mids = intermediateReopened({
      stage: parallel[1], targetStage: parallel[0], allStages: parallel,
    });
    // Прежний расчёт по sort_order давал [] — шелкография оставалась done
    // с полным тиражом, и перекроенные единицы шли в пошив без печати.
    expect(mids.map((m) => m.id)).toEqual(['p-silk']);
  });

  it('швейка ждёт обе ветки и не трогается: этих единиц она не видела', () => {
    const mids = intermediateReopened({
      stage: parallel[1], targetStage: parallel[0], allStages: parallel,
    });
    expect(mids.map((m) => m.id)).not.toContain('p-sew');
  });

  it('подтверждение называет шелкографию — текст совпадает с фактом', () => {
    const msg = defectRollbackWarning({
      stage: parallel[1], targetStage: parallel[0], allStages: parallel,
      deptNameById: names, qty: 20,
    });
    expect(msg).toContain('Шелкография');
  });

  it('если швейка уже начата — переоткрывается тоже', () => {
    const started = parallel.map((s) => (s.id === 'p-sew' ? { ...s, status: 'done' } : s));
    const mids = intermediateReopened({
      stage: started[1], targetStage: started[0], allStages: started,
    });
    expect(mids.map((m) => m.id).sort()).toEqual(['p-sew', 'p-silk']);
  });
});

describe('descendantStages — обход графа', () => {
  it('собирает транзитивных потомков, сам этап не включает', () => {
    expect(descendantStages(stages, 's1').map((s) => s.id)).toEqual(['s2', 's3', 's4']);
    expect(descendantStages(stages, 's3').map((s) => s.id)).toEqual(['s4']);
    expect(descendantStages(stages, 's4')).toEqual([]);
  });

  it('этап, встречающийся на двух путях, возвращается один раз', () => {
    const diamond = [
      { id: 'a', department_id: 'd-cut', sort_order: 10, status: 'done', depends_on: [] },
      { id: 'b', department_id: 'd-emb', sort_order: 20, status: 'done', depends_on: ['a'] },
      { id: 'c', department_id: 'd-silk', sort_order: 20, status: 'done', depends_on: ['a'] },
      { id: 'd', department_id: 'd-sew', sort_order: 30, status: 'done', depends_on: ['b', 'c'] },
    ];
    expect(descendantStages(diamond, 'a').map((s) => s.id).sort()).toEqual(['b', 'c', 'd']);
  });

  it('петля в данных не подвешивает обход', () => {
    const cyclic = [
      { id: 'x', department_id: 'd-cut', sort_order: 10, status: 'done', depends_on: ['y'] },
      { id: 'y', department_id: 'd-sew', sort_order: 20, status: 'done', depends_on: ['x'] },
    ];
    expect(descendantStages(cyclic, 'x').map((s) => s.id)).toEqual(['y']);
  });
});
