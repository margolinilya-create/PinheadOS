import { describe, expect, it } from 'vitest';
import type { ErpItemStage } from '../types';
import {
  SUBCONTRACT_ACTIONS,
  availableActions,
  readyToSendQty,
  subcontractView,
} from './subcontractFlow';

/**
 * Проверочный сценарий документа 20.08 идёт здесь дословно:
 * 500 худи, маршрут «Закрой → Швейка → Подряд: Варка → ВТО → Склад»,
 * первые 200 после пошива уходят на варку, остальные 300 продолжают
 * производство независимо.
 */

type Stage = Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null };

const QTY = 500;

function stages(sewingDone: number, sub: Partial<Stage> = {}): Stage[] {
  return [
    { id: 'cut', status: 'done', depends_on: [], qty_done: QTY },
    { id: 'sew', status: 'in_progress', depends_on: ['cut'], qty_done: sewingDone },
    { id: 'sub', status: 'waiting', depends_on: ['sew'], qty_done: 0, ...sub },
  ];
}

const subStage = (all: Stage[]) => all.find((s) => s.id === 'sub')!;

describe('готово к передаче считается из маршрута, а не хранится', () => {
  it('пока швейка не сдала — передавать нечего', () => {
    const all = stages(0);
    expect(readyToSendQty(subStage(all), all, QTY, null)).toBe(0);
    expect(subcontractView(null, subStage(all), all, QTY).display).toBe('planned');
  });

  it('швейка сдала 200 — подряд получает 200 готовых к передаче', () => {
    const all = stages(200);
    const view = subcontractView({ phase: 'planned' }, subStage(all), all, QTY);
    expect(view.readyQty).toBe(200);
    expect(view.display).toBe('materials_ready');
    // Хранимая фаза при этом не двигалась: её двигает передача
    expect(view.stored).toBe('planned');
  });

  it('переданное вычитается: сдано 200, передано 200 — к передаче ноль', () => {
    const all = stages(200);
    const view = subcontractView(
      { phase: 'at_contractor', qty_sent: 200 }, subStage(all), all, QTY);
    expect(view.readyQty).toBe(0);
  });

  it('швейка досдала ещё 100 — к передаче снова есть остаток', () => {
    const all = stages(300);
    const view = subcontractView(
      { phase: 'at_contractor', qty_sent: 200 }, subStage(all), all, QTY);
    expect(view.readyQty).toBe(100);
  });

  it('после передачи хранимая фаза авторитетна — «ожидает приёмки» не подменяется', () => {
    // Иначе остаток тиража прятал бы то, чего ждёт склад
    const all = stages(500);
    const view = subcontractView(
      { phase: 'returned', qty_sent: 200, qty_returned: 200 }, subStage(all), all, QTY);
    expect(view.display).toBe('returned');
    expect(view.readyQty).toBe(300);
  });
});

describe('расхождение считается, а не хранится', () => {
  it('передано 100, вернулось 100, принято 97 — брак 3, потерь нет', () => {
    const all = stages(500);
    const view = subcontractView(
      { phase: 'accepted', qty_sent: 100, qty_returned: 100, qty_accepted: 97 },
      subStage(all), all, QTY);
    expect(view.defect).toBe(3);
    expect(view.lost).toBe(0);
  });

  it('передано 100, вернулось 95 — пять не вернулось', () => {
    const all = stages(500);
    const view = subcontractView(
      { phase: 'returned', qty_sent: 100, qty_returned: 95 }, subStage(all), all, QTY);
    expect(view.lost).toBe(5);
  });
});

describe('доступные действия', () => {
  const viewAt = (phase: string, qty_sent = 0, sewingDone = 200) => {
    const all = stages(sewingDone);
    return subcontractView({ phase, qty_sent }, subStage(all), all, QTY);
  };

  it('передавать нечего — действий нет', () => {
    expect(availableActions(viewAt('planned', 0, 0))).toEqual([]);
  });

  it('готово к передаче — только «Передать»', () => {
    expect(availableActions(viewAt('planned')).map((a) => a.key)).toEqual(['send']);
  });

  it('у подрядчика — «Готово», «Вернулось» и догрузка остатка', () => {
    expect(availableActions(viewAt('at_contractor', 100)).map((a) => a.key))
      .toEqual(['ready', 'return', 'send']);
  });

  it('всё передано — догрузки нет', () => {
    expect(availableActions(viewAt('at_contractor', 200)).map((a) => a.key))
      .toEqual(['ready', 'return']);
  });

  it('ожидает приёмки — только «На переделку»: принимает СКЛАД', () => {
    // Кнопка «принято» здесь была бы вторым путём к тому же переходу —
    // мимо складского гейта и мимо фиксации брака
    expect(availableActions(viewAt('returned', 200)).map((a) => a.key)).toEqual(['rework']);
  });

  it('на переделке — «Вернулось»', () => {
    expect(availableActions(viewAt('rework', 200)).map((a) => a.key)).toEqual(['return']);
  });

  it('принято складом — действий больше нет', () => {
    expect(availableActions(viewAt('accepted', 200))).toEqual([]);
  });
});

describe('журнал пишется там, где меняются количества', () => {
  it('передача и возврат — записи журнала', () => {
    expect(SUBCONTRACT_ACTIONS.send.move).toBe('send');
    expect(SUBCONTRACT_ACTIONS.return.move).toBe('return');
  });

  it('«готово у подрядчика» и «на переделку» количеств не трогают', () => {
    // Переделка повторной записью `send` удвоила бы «передано»: изделия
    // уже посчитаны вернувшимися
    expect(SUBCONTRACT_ACTIONS.ready.move).toBeNull();
    expect(SUBCONTRACT_ACTIONS.rework.move).toBeNull();
  });
});
