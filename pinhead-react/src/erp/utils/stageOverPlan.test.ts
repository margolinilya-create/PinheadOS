import { describe, expect, it } from 'vitest';
import {
  deptAllowsOverPlan, overPlanBlock, overPlanConfirm, stageQtyCap,
} from './stageOverPlan';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';
import type { InputStage } from './stageInput';

/**
 * «ПЛЮСЫ» ТОЛЬКО НА ЗАКРОЕ (правка заказчика 12.09, вторая порция, п. 4).
 *
 * Сценарии документа проверяются дословно: «заказ 100 → закрой 105 →
 * следующие этапы принимают максимум 105» и «заказ 100 → закрой 100 →
 * попытка сдать 101+ на любом следующем этапе блокируется».
 *
 * Клиентское правило и серверный страж — ОДНО правило, и здесь же сверяются
 * его половины: клиент, разрешающий то, что сервер отклонит, даёт «кнопка
 * есть, действие падает» — запрещённое в этом проекте состояние.
 */

const CUT = { allows_over_plan: true };
const SEW = { allows_over_plan: false };

const cutting = (over: Record<string, unknown> = {}) => ({
  id: 'st-cut', status: 'done', depends_on: [], qty_done: 100, ...over,
} as InputStage & { qty_done: number });
const next = (over: Record<string, unknown> = {}) => ({
  id: 'st-sew', status: 'in_progress', depends_on: ['st-cut'], qty_done: 0, ...over,
} as InputStage & { qty_done: number });

describe('право на превышение — свойство участка', () => {
  it('строго с новым значением: колонки может не быть вовсе', () => {
    expect(deptAllowsOverPlan(CUT)).toBe(true);
    expect(deptAllowsOverPlan(SEW)).toBe(false);
    /**
     * У участков из старых фикстур и урезанных выборок поля нет: мягкое
     * `!== false` объявило бы «плюс» разрешённым ВЕЗДЕ, то есть сняло бы
     * правило целиком, ничего не сломав на вид.
     */
    expect(deptAllowsOverPlan({})).toBe(false);
    expect(deptAllowsOverPlan(null)).toBe(false);
    expect(deptAllowsOverPlan(undefined)).toBe(false);
  });
});

describe('сценарий 1: закрой сдал 105 — дальше максимум 105', () => {
  const stages = [cutting({ qty_done: 105 }), next()];

  it('потолок следующего этапа равен переданному', () => {
    expect(stageQtyCap(stages[1], stages, 100, SEW)).toBe(105);
    expect(overPlanBlock(105, stages[1], stages, 100, SEW)).toBeNull();
  });

  it('сто шестая штука не принимается', () => {
    const msg = overPlanBlock(106, stages[1], stages, 100, SEW);
    expect(msg).toContain('105');
    // Текст называет, ОТКУДА взялся потолок: иначе его не проверить
    expect(msg).toContain('передано 105');
  });
});

/**
 * ПОТОЛОК — ВХОД ЭТАПА (правка 05.10, п. 1): «цех не может сдать больше,
 * чем получил». Решение 12.09 (потолок — большее из тиража и переданного)
 * отменено: оно и давало «швейка требует ещё 50», когда закрой выкроил 102
 * из 150. «Завершить этап» у участка без формы теперь пишет принятое
 * (`stageDonePatch`), поэтому «кнопка есть, действие падает» не возникает.
 */
describe('недосдача предыдущего этапа — потолок равен переданному', () => {
  const stages = [cutting({ status: 'in_progress', qty_done: 40 }), next()];

  it('сдать можно ровно переданное', () => {
    expect(stageQtyCap(stages[1], stages, 100, SEW)).toBe(40);
    expect(overPlanBlock(40, stages[1], stages, 100, SEW)).toBeNull();
  });

  it('сверх переданного — нельзя, даже в пределах тиража', () => {
    expect(overPlanBlock(41, stages[1], stages, 100, SEW)).toContain('передано 40');
  });

  it('пример документа: крой 102, пошив 100 — ВТО получает 100', () => {
    const route = [
      cutting({ qty_done: 102 }),
      next({ id: 'sew', status: 'done', qty_done: 100, qty_passthrough: false }),
      next({ id: 'vto', depends_on: ['sew'] }),
    ];
    expect(stageQtyCap(route[2], route, 150, SEW)).toBe(100);
  });
});

describe('сценарий 2: закрой сдал ровно 100 — 101 блокируется', () => {
  const stages = [cutting({ qty_done: 100 }), next()];

  it('сто принимается, сто один — нет', () => {
    expect(overPlanBlock(100, stages[1], stages, 100, SEW)).toBeNull();
    expect(overPlanBlock(101, stages[1], stages, 100, SEW)).toContain('100');
  });

  it('уже сданное на этапе входит в потолок', () => {
    // Цех вводит ПРИРАЩЕНИЕ: сдал 60, потолок оставшегося — 40
    const partial = [cutting({ qty_done: 100 }), next({ qty_done: 60 })];
    expect(stageQtyCap(partial[1], partial, 100, SEW)).toBe(40);
    expect(overPlanBlock(41, partial[1], partial, 100, SEW)).toContain('40');
  });
});

describe('у закроя потолка нет, но превышение спрашивают', () => {
  const stages = [cutting({ status: 'in_progress', qty_done: 0 })];

  it('потолка нет вовсе', () => {
    expect(stageQtyCap(stages[0], stages, 100, CUT)).toBeNull();
    expect(overPlanBlock(1000, stages[0], stages, 100, CUT)).toBeNull();
  });

  it('превышение тиража называет разницу', () => {
    const msg = overPlanConfirm(105, { qty_done: 0 }, 100, CUT);
    expect(msg).toContain('плюс 5');
    expect(msg).toContain('105');
  });

  it('ровно тираж подтверждения не требует', () => {
    expect(overPlanConfirm(100, { qty_done: 0 }, 100, CUT)).toBeNull();
    // Приращение считается от уже сданного: 60 + 40 = тираж
    expect(overPlanConfirm(40, { qty_done: 60 }, 100, CUT)).toBeNull();
    expect(overPlanConfirm(41, { qty_done: 60 }, 100, CUT)).toContain('плюс 1');
  });

  it('у участка без права подтверждения нет — там отказ', () => {
    expect(overPlanConfirm(105, { qty_done: 0 }, 100, SEW)).toBeNull();
  });
});

describe('первый этап маршрута: предшественников нет', () => {
  it('потолок — тираж позиции', () => {
    const only = [next({ id: 'st-1', depends_on: [] })];
    expect(stageQtyCap(only[0], only, 100, SEW)).toBe(100);
  });
});

/**
 * СЕРВЕРНАЯ ПОЛОВИНА ПОВТОРЯЕТ КЛИЕНТСКУЮ.
 *
 * Клиентский гейт без серверного — дыра через REST: то же число уходит
 * прямым UPDATE мимо формы. Проверка стоит в BEFORE-триггере таблицы, потому
 * что он ПОСЛЕДНЕЕ слово для любой записи `qty_done` (урок 12.09: «одну
 * и ту же величину могут резать ДВА места»).
 */
describe('страж повторяет правило словами', () => {
  const CLAMP = withoutComments(
    functionBody(latestDefining('erp_clamp_stage_qty'), 'erp_clamp_stage_qty'),
  );
  const INPUT = withoutComments(
    functionBody(latestDefining('erp_stage_input_qty'), 'erp_stage_input_qty'),
  );
  const INPUT_D = withoutComments(
    functionBody(latestDefining('erp_stage_input_qty_d'), 'erp_stage_input_qty_d'),
  );

  it('потолок спрашивается у УЧАСТКА, а не у кода цеха', () => {
    expect(CLAMP).toMatch(/allows_over_plan/);
    // Константы «cutting» в стороже быть не должно: право живёт в данных
    expect(CLAMP).not.toMatch(/'cutting'/);
  });

  it('ОТКАЗ, а не молчаливая обрезка', () => {
    expect(CLAMP).toMatch(/raise exception/);
    // Обрезка вернула бы 100 там, где цех сдал 105, и вызывающий увидел бы
    // «сохранилось»: ровно тот дефект, что записан в правилах 12.09
    expect(CLAMP).not.toMatch(/new\.qty_done := v_cap/);
  });

  it('вход этапа считается тем же правилом, что на клиенте', () => {
    // Обёртка зовёт рекурсивную половину — правило живёт в ней
    expect(INPUT).toMatch(/erp_stage_input_qty_d\(p_stage_id, 0\)/);
    // Минимум по предшественникам (параллельные ветки нанесения обрабатывают
    // ОДНИ И ТЕ ЖЕ единицы — сумма дала бы 200 при тираже 100)
    expect(INPUT_D).toMatch(/least\(/);
    // Выход — факт; прозрачный этап отдаёт свой вход — зеркало isPassthrough
    expect(INPUT_D).toMatch(/p\.status = 'skipped' or p\.qty_passthrough/);
    expect(INPUT_D).toMatch(/erp_stage_input_qty_d\(p\.id, p_depth \+ 1\)/);
    // Тиража у закрытого предшественника больше нет (правка 05.10)
    expect(INPUT_D).not.toMatch(/greatest\(coalesce\(p\.qty_done, 0\), v_total\)/);
  });

  it('потолок — вход этапа; тираж — только у служебных меток', () => {
    // Правка 05.10: «цех не может сдать больше, чем получил». Перенос между
    // цехами и приёмка подряда закрывают этап по тиражу — у них прежний
    // потолок, большее из тиража и входа
    expect(CLAMP).toMatch(/v_cap := public\.erp_stage_input_qty\(new\.id\)/);
    expect(CLAMP).toMatch(/erp\.moving/);
    expect(CLAMP).toMatch(/erp\.subcontract_rollup/);
    expect(CLAMP).toMatch(/if v_service then/);
  });

  it('проверка идёт только когда число выросло', () => {
    // Возврат брака уменьшает qty_done, смена статуса его не трогает —
    // обход графа на каждой записи счётчика этому триггеру не нужен
    expect(CLAMP).toMatch(/new\.qty_done > coalesce\(old\.qty_done, 0\)/);
  });
});
