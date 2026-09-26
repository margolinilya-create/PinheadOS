// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FILE_RESULT_KINDS, isFileResultStage, stageResultFileBlock, stageResultFiles,
} from './stageResult';
import { stageDoneWarning } from './stageDone';

/**
 * ПРАВКА ЗАКАЗЧИКА 13.09, П. 9: «Разработка программы вышивки» завершается
 * без количественной логики.
 *
 * Что было: «сам этап реализован правильно: результатом является файл
 * программы. Но при нажатии „Завершить этап" система всё равно запускает общую
 * логику производственного этапа и считает, что нужно сдать количество изделий.
 * Появляется окно „Завершить этап не полностью?" с расчётом 0 из 100 шт».
 *
 * Цена видна на боевой базе: у двух закрытых таких этапов `qty_done` стоит 100
 * и 150 при нулевой фактической выработке — приписка ровно того рода, против
 * которой и заведён диалог `stageDoneWarning`.
 */
describe('Этап с файловым результатом', () => {
  const stage = (extra: Record<string, unknown> = {}) => ({
    id: 'st-1', qty_done: 0, result_kind: 'embroidery_program', ...extra,
  });

  it('узнаётся по колонке `result_kind`, а не по имени операции', () => {
    expect(isFileResultStage(stage())).toBe(true);
    /**
     * Опознание по `operation` напрашивалось и было бы дефектом: такой
     * операции нет в справочнике `route_operation` вовсе — это свободный
     * ввод конструктора маршрута, и первое же переименование МОЛЧА вернуло бы
     * цеху поля количества.
     */
    expect(isFileResultStage({ id: 'st-2', operation: 'Разработка программы вышивки' } as never))
      .toBe(false);
    expect(isFileResultStage({ id: 'st-3' })).toBe(false);
    expect(isFileResultStage(null)).toBe(false);
  });

  it('перечисление видов непусто — иначе признак не сработал бы никогда', () => {
    expect(FILE_RESULT_KINDS).toContain('embroidery_program');
  });

  it('количественного предупреждения при завершении НЕ показывает', () => {
    const input = {
      stage: stage(),
      qty: 100,
      allStages: [{ id: 'st-1', department_id: 'd1', depends_on: [] }],
    };
    expect(stageDoneWarning(input)).toBeNull();
    /**
     * Мутация: снимите признак — и возвращается ровно тот текст, на который
     * жалуется документ. Без этой половины сторож был бы зелен и на сломанном
     * коде: у этапа, закрытого целиком, предупреждения нет и так.
     */
    const asUsual = stageDoneWarning({ ...input, stage: { id: 'st-1', qty_done: 0 } });
    expect(asUsual).toContain('0 из 100');
  });

  it('без приложенного файла закрывать нельзя, с файлом — можно', () => {
    const order = {
      attachments: [
        // Чужой этап и чужой вид — ни один не считается результатом этого
        { id: 'a1', kind: 'stage_result', stage_id: 'st-other' },
        { id: 'a2', kind: 'subcontract', stage_id: 'st-1' },
      ],
    } as never;
    expect(stageResultFiles(order, 'st-1')).toHaveLength(0);
    expect(stageResultFileBlock(stage(), order)).toContain('программы вышивки');

    const withFile = {
      attachments: [{ id: 'a3', kind: 'stage_result', stage_id: 'st-1' }],
    } as never;
    expect(stageResultFiles(withFile, 'st-1')).toHaveLength(1);
    expect(stageResultFileBlock(stage(), withFile)).toBeNull();
  });

  it('обычного этапа гейт файла не касается', () => {
    expect(stageResultFileBlock({ id: 'st-9' }, { attachments: [] })).toBeNull();
  });
});

/**
 * ГЕЙТ ЖИВЁТ У ПИСАТЕЛЯ, А НЕ ТОЛЬКО У КНОПКИ.
 *
 * Кнопка «Завершить этап» гаснет в очереди цеха и на странице задания, но
 * этап закрывают ещё дорожкой «Завершено» на канбане и чипом производственного
 * плана — там кнопки нет вовсе. Правило проекта с 03.09: такой гейт ставится
 * у записи, иначе следующий путь пройдёт мимо.
 */
describe('Гейт файла стоит у писателя статуса', () => {
  it('`completionBlockFor` спрашивает `stageResultFileBlock`', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/erp/store/slices/stagesSlice.ts'), 'utf8',
    );
    const fn = src.slice(src.indexOf('function completionBlockFor'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('stageResultFileBlock(');
    /**
     * И ДО проверки «запись добирает тираж»: у такого этапа `qty_done`
     * остаётся нулём по построению, и ниже гейт не выполнился бы никогда.
     */
    expect(body.indexOf('stageResultFileBlock('))
      .toBeLessThan(body.indexOf('< item.qty'));
  });
});

/**
 * «Количество заказа не должно… изменяться при его завершении».
 *
 * `qty_done` у такого этапа НЕ ПИШЕТСЯ вовсе, а не пишется нулём: ноль был бы
 * утверждением «цех сдал ноль», а у этапа, который изделий не производит,
 * этой величины не существует.
 */
describe('Завершение файлового этапа не пишет количество', () => {
  it('`onDone` ветвится по `isFileResultStage`', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/erp/screens/queue/useStageActions.js'), 'utf8',
    );
    const fn = src.slice(src.indexOf('const onDone ='));
    const body = fn.slice(0, fn.indexOf('}, [setStageStatus'));
    expect(body).toContain('isFileResultStage(');
    // Пустой патч у файлового этапа, `qty_done` — только у обычного
    expect(body).toMatch(/fileResult \? \{\} : \{ qty_done/);
  });
});
