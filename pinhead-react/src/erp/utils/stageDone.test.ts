import { describe, it, expect } from 'vitest';
import { stageDoneWarning, dependentStageNames } from './stageDone';

const deptNames = new Map([
  ['d-cut', 'Раскрой'],
  ['d-sew', 'Швейка'],
  ['d-vto', 'ВТО'],
]);

const stages = [
  { id: 's-cut', department_id: 'd-cut', depends_on: [] },
  { id: 's-sew', department_id: 'd-sew', depends_on: ['s-cut'] },
  { id: 's-vto', department_id: 'd-vto', depends_on: ['s-sew'] },
];

describe('stageDoneWarning', () => {
  it('весь тираж сдан — подтверждать нечего', () => {
    expect(stageDoneWarning({
      stage: { id: 's-cut', qty_done: 100 }, qty: 100, allStages: stages, deptNameById: deptNames,
    })).toBeNull();
  });

  it('сдано больше тиража (переделка) — тоже молча', () => {
    expect(stageDoneWarning({
      stage: { id: 's-cut', qty_done: 120 }, qty: 100, allStages: stages, deptNameById: deptNames,
    })).toBeNull();
  });

  it('сдана часть — называет остаток и следующий цех', () => {
    const msg = stageDoneWarning({
      stage: { id: 's-cut', qty_done: 40 }, qty: 100, allStages: stages, deptNameById: deptNames,
    });
    expect(msg).toContain('40 из 100');
    expect(msg).toContain('60 шт');
    expect(msg).toContain('Швейка');
    expect(msg).toContain('100 шт');
  });

  it('qty_done не проставлен — считается за ноль', () => {
    const msg = stageDoneWarning({
      stage: { id: 's-cut', qty_done: null }, qty: 50, allStages: stages, deptNameById: deptNames,
    });
    expect(msg).toContain('0 из 50');
    expect(msg).toContain('50 шт');
  });

  it('последний этап маршрута — про следующий цех не врёт', () => {
    const msg = stageDoneWarning({
      stage: { id: 's-vto', qty_done: 10 }, qty: 30, allStages: stages, deptNameById: deptNames,
    });
    expect(msg).toContain('20 шт');
    expect(msg).not.toContain('откроется');
  });

  it('несколько зависимых этапов перечисляются все', () => {
    const parallel = [
      { id: 's-cut', department_id: 'd-cut', depends_on: [] },
      { id: 's-dtf', department_id: 'd-dtf', depends_on: ['s-cut'] },
      { id: 's-emb', department_id: 'd-emb', depends_on: ['s-cut'] },
    ];
    const names = new Map([['d-dtf', 'ДТФ'], ['d-emb', 'Вышивка']]);
    const msg = stageDoneWarning({
      stage: { id: 's-cut', qty_done: 1 }, qty: 10, allStages: parallel, deptNameById: names,
    });
    expect(msg).toContain('ДТФ, Вышивка');
  });

  it('без карты имён — нейтральная формулировка вместо пустоты', () => {
    expect(dependentStageNames({
      stage: { id: 's-cut', qty_done: 0 }, qty: 10, allStages: stages,
    })).toEqual(['следующий этап']);
  });
});
