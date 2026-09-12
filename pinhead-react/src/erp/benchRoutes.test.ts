import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, ROUTES_NOT_SHOT } from '../../e2e/bench/routes';

/**
 * КАЖДЫЙ ЭКРАН РАЗДЕЛА ПОПАДАЕТ В ОБХОД ГЛАЗАМИ.
 *
 * Стенд снимков отвечает на «как это выглядит», и экран, которого в его матрице
 * нет, не проверяется НИЧЕМ: дефекты вида (наложение, обрезка, разорванное
 * слово, съехавшая колонка) unit-тесты не видят по построению — разметка та же,
 * поведение то же, отличается только вид.
 *
 * Поэтому список состояний сверяется с настоящими `<Route path=…>` из
 * `ErpApp.jsx`: новый экран валит этот сторож, а не выпадает из обхода молча.
 * Тот же приём, что у витрины `/styleguide`, где списки берутся из словарей,
 * а не вписываются руками.
 *
 * Исключения перечислены ПОИМЁННО и с причиной (`ROUTES_NOT_SHOT`): «редирект»
 * и «в фикстурах нет такой строки» — это ответы, а «потом добавим» ответом
 * не является.
 */

const APP = join(process.cwd(), 'src', 'erp', 'ErpApp.jsx');

/** Пути из <Route path="…"> — источник правды о составе экранов */
function declaredRoutes(): string[] {
  const src = readFileSync(APP, 'utf8');
  const found = [...src.matchAll(/<Route\s+[^>]*path="([^"]+)"/g)].map((m) => m[1]);
  // многострочные <Route\n path="…"> — вторая форма записи в этом файле
  const multi = [...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set([...found, ...multi])];
}

describe('матрица стенда покрывает все экраны раздела', () => {
  it('в ErpApp объявлены маршруты (иначе сторож сторожит пустоту)', () => {
    expect(declaredRoutes().length).toBeGreaterThan(10);
  });

  it('каждый маршрут либо снимается стендом, либо назван в исключениях с причиной', () => {
    const shot = new Set(SHOTS.map((s) => s.route));
    const missing = declaredRoutes().filter((r) => !shot.has(r) && !(r in ROUTES_NOT_SHOT));
    expect(missing, `маршруты вне обхода: ${missing.join(', ')}`).toEqual([]);
  });

  it('исключения не протухли: каждое относится к существующему маршруту', () => {
    const declared = new Set(declaredRoutes());
    const stale = Object.keys(ROUTES_NOT_SHOT).filter((r) => !declared.has(r));
    expect(stale, `исключение для несуществующего маршрута: ${stale.join(', ')}`).toEqual([]);
  });

  it('у каждой причины исключения есть текст, а не пустая строка', () => {
    for (const [route, reason] of Object.entries(ROUTES_NOT_SHOT)) {
      expect(reason.length, `${route}: причина не названа`).toBeGreaterThan(10);
    }
  });

  it('имена снимков уникальны — иначе один перезапишет другой', () => {
    const names = SHOTS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
