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

  /**
   * КРИТЕРИЙ ГОТОВНОСТИ П. 3.8: «можно корректно провести подрядный этап
   * на материале подрядчика без фиктивной передачи 200 единиц».
   *
   * Остаток считается от `qty_in_work`, а не от переданного, — иначе
   * на материалах подрядчика (`qty_sent` всегда 0) кнопка предлагала бы
   * отдать весь тираж заново после каждого запуска.
   */
  it('на материалах подрядчика запуск не требует передачи', () => {
    const all = stages(200);
    const view = subcontractView(
      {
        phase: 'at_contractor', material_source: 'contractor',
        qty_in_work: 200, qty_sent: 0,
      },
      subStage(all), all, QTY);
    expect(view.contractorMaterials).toBe(true);
    expect(view.inWorkQty).toBe(200);
    // Работа взята — предлагать отдать те же 200 снова нельзя
    expect(view.readyQty).toBe(0);
    // И это не недостача: мы ничего не передавали
    expect(view.lost).toBe(0);
  });

  /** У операций до правки `qty_in_work` пуст — там остаток от переданного */
  it('операция без qty_in_work считает остаток по-старому', () => {
    const all = stages(200);
    const view = subcontractView(
      { phase: 'at_contractor', qty_sent: 150 }, subStage(all), all, QTY);
    expect(view.readyQty).toBe(50);
    expect(view.inWorkQty).toBe(150);
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

describe('брак отмечается явно, недостача считается', () => {
  /** Главный случай п. 3.9: вернулось 200, принято 0 — это НЕ брак */
  it('до приёмки непринятое ждёт приёмки, а не считается браком', () => {
    const all = stages(500);
    const view = subcontractView(
      { phase: 'returned', qty_sent: 200, qty_returned: 200, qty_accepted: 0 },
      subStage(all), all, QTY);
    expect(view.awaitingAccept).toBe(200);
    expect(view.defect).toBe(0);
  });

  it('после приёмки распределено: принято 197, брак 3', () => {
    const all = stages(500);
    const view = subcontractView(
      {
        phase: 'accepted', qty_sent: 200, qty_returned: 200,
        qty_accepted: 197, qty_defect: 3,
      },
      subStage(all), all, QTY);
    expect(view.defect).toBe(3);
    expect(view.awaitingAccept).toBe(0);
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

  it('готово к передаче — только «Передать в работу»', () => {
    expect(availableActions(viewAt('planned')).map((a) => a.key)).toEqual(['start']);
  });

  /**
   * ПОРЯДОК ЗДЕСЬ — ЭТО ПРИОРИТЕТ (п. 3.3): первое действие интерфейс рисует
   * главным. «Готово у подрядчика» перестало быть обязательным шагом (п. 3.5),
   * поэтому главное — возврат, а отметка готовности идёт вторичной.
   */
  it('у подрядчика — главное «Зафиксировать возврат», потом отметка и догрузка', () => {
    expect(availableActions(viewAt('at_contractor', 100)).map((a) => a.key))
      .toEqual(['return', 'ready', 'send']);
  });

  it('всё передано — догрузки нет', () => {
    expect(availableActions(viewAt('at_contractor', 200)).map((a) => a.key))
      .toEqual(['return', 'ready']);
  });

  it('ожидает приёмки — брак и переделка: ПРИНИМАЕТ склад', () => {
    // Кнопка «принято» здесь была бы вторым путём к тому же переходу —
    // мимо складского гейта и мимо фиксации брака
    expect(availableActions(viewAt('returned', 200)).map((a) => a.key))
      .toEqual(['defect', 'rework']);
  });

  it('на переделке — «Вернулось»', () => {
    expect(availableActions(viewAt('rework', 200)).map((a) => a.key)).toEqual(['return']);
  });

  it('принято складом — действий больше нет', () => {
    expect(availableActions(viewAt('accepted', 200))).toEqual([]);
  });
});

describe('журнал пишется там, где меняются количества', () => {
  it('передача, возврат и брак — записи журнала', () => {
    expect(SUBCONTRACT_ACTIONS.start.move).toBe('send');
    expect(SUBCONTRACT_ACTIONS.send.move).toBe('send');
    expect(SUBCONTRACT_ACTIONS.return.move).toBe('return');
    expect(SUBCONTRACT_ACTIONS.defect.move).toBe('defect');
  });

  it('«готово у подрядчика» и «на переделку» количеств не трогают', () => {
    // Переделка повторной записью `send` удвоила бы «передано»: изделия
    // уже посчитаны вернувшимися
    expect(SUBCONTRACT_ACTIONS.ready.move).toBeNull();
    expect(SUBCONTRACT_ACTIONS.rework.move).toBeNull();
  });

  /**
   * Объём работы спрашивают только те действия, которые его задают: запуск
   * и догрузка. У возврата и брака его нет — там количество означает штуки,
   * прошедшие через журнал, и второе поле рядом путало бы (п. 3.8).
   */
  it('объём работы спрашивают запуск и догрузка, а не возврат', () => {
    expect(SUBCONTRACT_ACTIONS.start.asksInWork).toBe(true);
    expect(SUBCONTRACT_ACTIONS.send.asksInWork).toBe(true);
    expect(SUBCONTRACT_ACTIONS.return.asksInWork).toBe(false);
    expect(SUBCONTRACT_ACTIONS.defect.asksInWork).toBe(false);
  });
});
