import { describe, expect, it } from 'vitest';
import { stageInputQty, stageRemainingQty } from './stageInput';
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
   * 200 — вдвое больше, чем существует. Швейка может начать ровно столько,
   * сколько прошло через самую отстающую ветку.
   */
  it('несколько предшественников дают МИНИМУМ, а не сумму', () => {
    const silk = st('silk', 'in_progress', 80);
    const dtf = st('dtf', 'in_progress', 60);
    const sew = st('sew', 'waiting', 0, ['silk', 'dtf']);
    expect(stageInputQty(sew, [silk, dtf, sew], 100)).toBe(60);
  });

  it('выход предшественника не превышает тираж позиции', () => {
    const cut = st('cut', 'in_progress', 500);
    const sew = st('sew', 'waiting', 0, ['cut']);
    expect(stageInputQty(sew, [cut, sew], 100)).toBe(100);
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
