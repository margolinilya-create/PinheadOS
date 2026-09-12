import { describe, it, expect } from 'vitest';
import {
  HOLD_MS, sweptSteps, clampValue, valueAfterSteps, decimalsOf,
} from './stepperSweep';

/**
 * Кривая разгона проверяется ЗНАЧЕНИЯМИ — ради этого она и вынесена из
 * компонента. На jsdom нет ни кадров, ни реального времени, и «через секунду
 * удержания набежало столько-то» там не спросишь вовсе.
 */
describe('sweptSteps — шаги за время удержания', () => {
  it('до начала свипа шагов нет', () => {
    expect(sweptSteps(0)).toBe(0);
    expect(sweptSteps(-100)).toBe(0);
  });

  it('растёт монотонно', () => {
    let prev = -1;
    for (let ms = 0; ms <= 4000; ms += 50) {
      const n = sweptSteps(ms);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  /**
   * ПЕРВЫЕ ШАГИ ИДУТ НЕТОРОПЛИВО — это и есть смысл разгона. Если за первые
   * 200 мс свипа набежит десяток, отпустить на нужном значении не успеешь,
   * и свип станет бесполезен ровно там, где нужен (малые величины приёмки).
   */
  it('за первые 200 мс свипа набегает не больше трёх шагов', () => {
    expect(sweptSteps(200)).toBeLessThanOrEqual(3);
  });

  /**
   * А ДАЛЬШЕ — БЫСТРО, иначе тираж 120 удержанием не набрать, и человек
   * вернётся к клавиатуре.
   */
  it('за две секунды свипа набегает больше шестидесяти', () => {
    expect(sweptSteps(2000)).toBeGreaterThan(60);
  });

  it('после разгона частота постоянна — 40 шагов в секунду', () => {
    const a = sweptSteps(2000);
    const b = sweptSteps(3000);
    expect(b - a).toBe(40);
  });

  it('задержка до свипа достаточно велика, чтобы обычный тап не поехал', () => {
    // Тап человека — это 80–150 мс; порог обязан быть заметно выше
    expect(HOLD_MS).toBeGreaterThanOrEqual(300);
  });
});

describe('clampValue — границы', () => {
  it('зажимает с обеих сторон', () => {
    expect(clampValue(-5, 0, 10)).toBe(0);
    expect(clampValue(50, 0, 10)).toBe(10);
    expect(clampValue(5, 0, 10)).toBe(5);
  });

  it('необъявленная граница не трогает значение', () => {
    expect(clampValue(-5, undefined, 10)).toBe(-5);
    expect(clampValue(500, 0, undefined)).toBe(500);
  });
});

describe('valueAfterSteps', () => {
  it('идёт в обе стороны', () => {
    expect(valueAfterSteps(10, 3, 1, 1)).toBe(13);
    expect(valueAfterSteps(10, 3, -1, 1)).toBe(7);
  });

  it('упирается в границу, а не проезжает её', () => {
    expect(valueAfterSteps(8, 100, 1, 1, 0, 10)).toBe(10);
    expect(valueAfterSteps(2, 100, -1, 1, 0, 10)).toBe(0);
  });

  /**
   * ОКРУГЛЕНИЕ ПО ШАГУ — не косметика. У приёмки материала шаг 0.01
   * (`MaterialReceiptCard`), и без округления в поле количества приехало бы
   * 0.11000000000000001.
   */
  it('не даёт двоичного мусора на дробном шаге', () => {
    expect(valueAfterSteps(0.1, 1, 1, 0.01)).toBe(0.11);
    expect(valueAfterSteps(0, 3, 1, 0.01)).toBe(0.03);
  });
});

describe('decimalsOf', () => {
  it.each([
    [1, 0],
    [10, 0],
    [0.01, 2],
    [0.5, 1],
  ])('шаг %s → %i знаков', (step, expected) => {
    expect(decimalsOf(step)).toBe(expected);
  });
});
