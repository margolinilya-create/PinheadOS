import { describe, expect, it } from 'vitest';
import {
  isPassthrough, itemProducedQty, stageInputQty, stageOutputQty, stageRemainingQty,
} from './stageInput';
import type { InputStage } from './stageInput';

const st = (
  id: string,
  status: InputStage['status'],
  qtyDone = 0,
  deps: string[] = [],
): InputStage => ({ id, status, qty_done: qtyDone, depends_on: deps });

describe('stageInputQty', () => {
  it('первый этап маршрута принимает весь тираж', () => {
    const cut = st('cut', 'in_progress');
    expect(stageInputQty(cut, [cut], 100)).toBe(100);
  });

  it('один предшественник — сколько он сдал', () => {
    const cut = st('cut', 'in_progress', 40);
    const sew = st('sew', 'waiting', 0, ['cut']);
    expect(stageInputQty(sew, [cut, sew], 100)).toBe(40);
  });

  it('закрытый предшественник считается сданным целиком', () => {
    // Цех мог закрыть этап кнопкой «Готово» или переносом, не набивая qty_done
    const cut = st('cut', 'done', 0);
    const sew = st('sew', 'waiting', 0, ['cut']);
    expect(stageInputQty(sew, [cut, sew], 100)).toBe(100);
  });

  it('пропущенный этап тоже пропускает весь тираж дальше', () => {
    const cut = st('cut', 'skipped');
    const sew = st('sew', 'waiting', 0, ['cut']);
    expect(stageInputQty(sew, [cut, sew], 100)).toBe(100);
  });

  /**
   * Главное правило. Параллельные ветки нанесения обрабатывают ОДНИ И ТЕ ЖЕ
   * единицы: тираж 100 проходит и шелкографию, и ДТФ. Сумма выходов дала бы
   * 200 — вдвое больше, чем существует. Швейный цех может начать ровно столько,
   * сколько прошло через самую отстающую ветку.
   */
  it('несколько предшественников дают МИНИМУМ, а не сумму', () => {
    const silk = st('silk', 'in_progress', 80);
    const dtf = st('dtf', 'in_progress', 60);
    const sew = st('sew', 'waiting', 0, ['silk', 'dtf']);
    expect(stageInputQty(sew, [silk, dtf, sew], 100)).toBe(60);
  });

  /**
   * ПЕРЕВЫПОЛНЕНИЕ ПЕРЕДАЁТСЯ ДАЛЬШЕ (правка 12.09, п. 5): «если предыдущий
   * этап завершён с фактом 105 шт, следующий этап должен получить 105 шт
   * в работу, при этом количество заказа остаётся 100 шт».
   *
   * Прежде здесь стояла обрезка по тиражу, и она съедала «плюс» ровно там,
   * где он нужен: закрой сдал больше, а швейка не могла за это отчитаться.
   */
  it('выход предшественника несёт весь факт, включая сверх тиража', () => {
    const cut = st('cut', 'in_progress', 105);
    const sew = st('sew', 'waiting', 0, ['cut']);
    expect(stageInputQty(sew, [cut, sew], 100)).toBe(105);
  });

  /**
   * Fail-open: зависимости есть, а самих этапов в наборе нет (урезанный select).
   * Заниженный вход запретил бы цеху отчитаться за реально сделанное, поэтому
   * считаем по тиражу — как для первого этапа.
   */
  it('потерянные предшественники не обнуляют вход', () => {
    const sew = st('sew', 'waiting', 0, ['нет-такого']);
    expect(stageInputQty(sew, [sew], 100)).toBe(100);
  });

  it('отрицательные и пустые значения не ломают счёт', () => {
    const cut = st('cut', 'in_progress', -5);
    const sew = st('sew', 'waiting', 0, ['cut']);
    expect(stageInputQty(sew, [cut, sew], 100)).toBe(0);
    expect(stageInputQty(st('x', 'waiting'), [], 0)).toBe(0);
  });
});

describe('stageRemainingQty', () => {
  it('остаток — вход минус уже сделанное', () => {
    const cut = st('cut', 'done');
    const sew = st('sew', 'in_progress', 30, ['cut']);
    expect(stageRemainingQty(sew, [cut, sew], 100)).toBe(70);
  });

  it('переработка не даёт отрицательного остатка', () => {
    const cut = st('cut', 'in_progress', 20);
    const sew = st('sew', 'in_progress', 50, ['cut']);
    expect(stageRemainingQty(sew, [cut, sew], 100)).toBe(0);
  });
});

/**
 * ПРАВКА 05.10, п. 1: передаётся ФАКТ, а не план. «Покроили 102 — в пошив
 * передаётся 102. Пошили 100 — в ВТО передаётся 100». Принудительное
 * завершение закрывает этап, но изделий до плана не добавляет.
 */
describe('передача фактического количества (правка 05.10)', () => {
  const real = (
    id: string, status: InputStage['status'], qtyDone: number, deps: string[] = [],
  ): InputStage => ({ id, status, qty_done: qtyDone, depends_on: deps, qty_passthrough: false });

  it('пример документа: план 150, крой 102, пошив 100 — ВТО 100', () => {
    const cut = real('cut', 'done', 102);
    const sew = real('sew', 'done', 100, ['cut']);
    const vto = real('vto', 'waiting', 0, ['sew']);
    const all = [cut, sew, vto];
    expect(stageInputQty(sew, all, 150)).toBe(102);
    expect(stageInputQty(vto, all, 150)).toBe(100);
  });

  it('этап, закрытый с нулём ПОСЛЕ правки, передаёт ноль', () => {
    const sew = real('sew', 'done', 0);
    const vto = real('vto', 'waiting', 0, ['sew']);
    expect(stageInputQty(vto, [sew, vto], 150)).toBe(0);
  });

  it('прозрачный этап (закупка, старое закрытие) передаёт свой вход', () => {
    const cut = real('cut', 'done', 102);
    const supply: InputStage = { id: 'sup', status: 'done', qty_done: 0, depends_on: ['cut'], qty_passthrough: true };
    const sew = real('sew', 'waiting', 0, ['sup']);
    expect(stageInputQty(sew, [cut, supply, sew], 150)).toBe(102);
  });

  it('пропущенный этап прозрачен независимо от признака', () => {
    const cut = real('cut', 'done', 90);
    const skip: InputStage = { id: 'x', status: 'skipped', qty_done: 0, depends_on: ['cut'], qty_passthrough: false };
    const sew = real('sew', 'waiting', 0, ['x']);
    expect(stageInputQty(sew, [cut, skip, sew], 150)).toBe(90);
  });

  it('isPassthrough без колонки — закрытый с нулём (fail-open)', () => {
    expect(isPassthrough({ status: 'done', qty_done: 0 })).toBe(true);
    expect(isPassthrough({ status: 'done', qty_done: 5 })).toBe(false);
    expect(isPassthrough({ status: 'done', qty_done: 0, qty_passthrough: false })).toBe(false);
  });

  it('выпущено по позиции — минимум выходов терминальных этапов', () => {
    const cut = real('cut', 'done', 102);
    const sew = real('sew', 'done', 100, ['cut']);
    const vto = real('vto', 'done', 100, ['sew']);
    const fg: InputStage = { id: 'fg', status: 'in_progress', qty_done: 0, depends_on: ['vto'], qty_passthrough: true };
    expect(itemProducedQty({ qty: 150, stages: [cut, sew, vto, fg] })).toBe(100);
    expect(stageOutputQty(fg, [cut, sew, vto, fg], 150)).toBe(100);
    // Маршрута нет — тираж
    expect(itemProducedQty({ qty: 150, stages: [] })).toBe(150);
  });
});
