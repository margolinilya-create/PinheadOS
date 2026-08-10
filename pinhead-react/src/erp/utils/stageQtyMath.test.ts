import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';

/**
 * Счётчики этапа пишутся ПРИРАЩЕНИЕМ, и правило обрезки должно быть одно.
 *
 * Правило проекта: абсолют с клиента — потерянное обновление (два планшета
 * в одном цехе читают своё значение и затирают запись друг друга). Приращение
 * считает сервер, и до волны 3 формула обрезки была продублирована
 * в `erp_stage_report_progress` и `erp_stage_apply_defect`. Волна 3 добавляет
 * третью точку записи — журнал результатов, — и без общего правила это была бы
 * третья копия, которая разойдётся с остальными молча: расхождение проявится
 * не ошибкой, а неверным числом в отчёте цеха.
 *
 * Почему правило вынесено в функции-ВЫРАЖЕНИЯ, а не в функцию-обёртку с UPDATE:
 * обёртка заставила бы `erp_stage_apply_defect` писать строку дважды (счётчики,
 * затем статус), а `erp_stage_guard` — триггер. Одно комбинированное изменение
 * он разбирает один раз, разбитое на два — дважды, и «статус отдельно от
 * счётчиков» могло бы не пройти там, где комбинированное проходит. Рефакторинг
 * не должен оборачиваться отказом прав у цеха.
 */

/**
 * Тела функций, а не файлы миграций: одна миграция определяет сразу несколько
 * функций, и проверка «здесь ровно один UPDATE» на целом файле считала бы
 * чужие. `functionBody` режет по `$$ … $$` этой функции.
 */
const body = (fn: string) => withoutComments(functionBody(latestDefining(fn), fn));

const CLAMP_FILE = latestDefining('erp_clamp_done');
const CLAMP_DONE = body('erp_clamp_done');
const CLAMP_REWORK = body('erp_clamp_rework');
const PROGRESS_SQL = body('erp_stage_report_progress');
const DEFECT_SQL = body('erp_stage_apply_defect');
const MOVE_SQL = body('erp_stage_move_department');

describe('арифметика счётчиков этапа живёт в одном месте', () => {
  it('правило обрезки объявлено функциями-выражениями, а не обёрткой с UPDATE', () => {
    expect(CLAMP_FILE).toMatch(/create or replace function public\.erp_clamp_done\(/);
    expect(CLAMP_FILE).toMatch(/create or replace function public\.erp_clamp_rework\(/);
    // `immutable` — признак чистой арифметики: функция не читает данные
    expect(CLAMP_FILE).toMatch(/erp_clamp_done[\s\S]{0,200}immutable/);
    // Обёртки с UPDATE быть не должно: она разбила бы одно изменение на два
    expect(CLAMP_DONE).not.toMatch(/update /);
    expect(CLAMP_REWORK).not.toMatch(/update /);
  });

  it('сделано обрезается снизу нулём и сверху тиражом', () => {
    expect(CLAMP_DONE).toMatch(/greatest\(least\(/);
  });

  /**
   * У переделки потолка нет намеренно: одну и ту же единицу могут вернуть
   * в переделку дважды, и это не ошибка данных, а второй заход по браку.
   */
  it('переделка ограничена только снизу', () => {
    expect(CLAMP_REWORK).toMatch(/greatest\(/);
    expect(CLAMP_REWORK).not.toMatch(/least\(/);
  });

  it.each([
    ['частичная готовность', () => PROGRESS_SQL],
    ['возврат брака', () => DEFECT_SQL],
  ])('%s считает счётчики общим правилом, а не своей формулой', (_name, sql) => {
    expect(sql()).toMatch(/public\.erp_clamp_done\(/);
    // Инлайновой копии формулы не осталось
    expect(sql()).not.toMatch(/least\(\s*coalesce\(s\.qty_done/);
  });

  it('возврат брака остаётся ОДНИМ update на патч', () => {
    const updates = DEFECT_SQL.match(/update public\.erp_item_stages/g) ?? [];
    expect(updates).toHaveLength(1);
  });

  /**
   * Перенос между цехами пишет полный тираж напрямую — обрезать там нечего,
   * и вызов общего правила был бы декоративным. Но целевой этап он ОБЯЗАН
   * искать в своём цикле: без `and cycle` при нескольких проходах образца
   * `select … into` молча возьмёт произвольную строку.
   */
  it('перенос ищет целевой этап в ТОМ ЖЕ цикле', () => {
    expect(MOVE_SQL).toMatch(/department_id = p_target_dept[\s\S]{0,80}and cycle = v_stage\.cycle/);
    expect(MOVE_SQL).toMatch(/insert into public\.erp_item_stages[\s\S]{0,200}cycle/);
  });
});
