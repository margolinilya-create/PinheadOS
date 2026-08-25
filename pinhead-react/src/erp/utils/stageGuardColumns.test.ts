/**
 * У КАЖДОЙ ОХРАНЯЕМОЙ КОЛОНКИ ЭТАПА ЕСТЬ СВОЯ ВЕТКА — ИЛИ НАЗВАННАЯ ПРИЧИНА.
 *
 * ЧТО ЗА ДЕФЕКТ. `v_guarded` в `erp_stage_guard` перечисляет колонки, при
 * изменении которых страж НЕ выходит рано. Правило проекта («колонка,
 * добавленная в `erp_item_stages`, попадает в `v_guarded` тем же коммитом»)
 * следило именно за этим списком — и это только половина дела: попасть
 * в `v_guarded` значит «дойти до проверок», а не «быть проверенным».
 *
 * `depends_on` и `item_id` в списке были, а ветки у них не было ни одной.
 * Изменение только этих колонок проходило функцию насквозь и упиралось лишь
 * в «есть хоть какое-то право `stage.*`» — а их шесть у любого рабочего.
 * То есть рабочий цеха мог через REST очистить `depends_on` своего этапа
 * (снять зависимость от предыдущего цеха и запуститься вне маршрута) или
 * перевесить этап на позицию чужого заказа. Соседний `sort_order`,
 * описывающий ту же сущность, при этом требовал `order.manage`.
 *
 * Найдено ревизией 25.08, закрыто миграцией 20260825120000.
 *
 * ЧТО СТОРОЖИТ ТЕСТ. Обе половины: список `v_guarded` и наличие ветки у
 * каждой его колонки. Колонка без ветки допускается ТОЛЬКО с причиной —
 * `NO_BRANCH` ниже. Перечень с объяснениями, а не «эти пропускаем»: без
 * причины следующий человек допишет сюда очередную колонку вместо ветки,
 * и сторож снова станет декоративным.
 */

import { describe, it, expect } from 'vitest';
import { latestDefining, functionBody, withoutComments } from './migrations.testutil';

const GUARD = 'erp_stage_guard';

/** Колонки, у которых ветки нет ОСОЗНАННО — с причиной на каждую */
const NO_BRANCH: Record<string, string> = {
  assignee: 'исполнитель проставляется тем же действием, что и взятие задания '
    + '(`stage.take`), отдельного права у него нет и заводить его незачем',
  started_at: 'служебная отметка первого входа в работу: её ставит переход '
    + 'в `in_progress`, и своё право у неё означало бы право на половину действия',
  finished_at: 'то же, но у перехода в `done` и у переоткрытия после брака',
  overdue_ack_at: 'объяснение просрочки — обязанность цеха, а не привилегия: '
    + 'гейтить его правом значит запретить цеху сказать, почему он стоит',
  overdue_comment: 'текстовая половина того же объяснения просрочки: гейт на ней '
    + 'оставил бы цеху отметку «прочитано» без возможности написать причину',
  block_reason: 'причина блокировки ходит вместе со статусом `blocked` '
    + '(см. `v_block_change`), и своя ветка у неё разошлась бы с той',
  notes: 'свободная заметка к этапу: ничего не решает ни в маршруте, ни в счётчиках',
};

/** Тело действующего стража — из ПОСЛЕДНЕЙ миграции, которая его пересоздаёт */
function guardBody(): string {
  return withoutComments(functionBody(latestDefining(GUARD), GUARD));
}

/** Колонки из присваивания `v_guarded := new.X is distinct from old.X or …` */
function guardedColumns(body: string): string[] {
  const start = body.indexOf('v_guarded :=');
  expect(start, 'в страже нет присваивания v_guarded').toBeGreaterThan(-1);
  const end = body.indexOf(';', start);
  const block = body.slice(start, end);
  return [...new Set([...block.matchAll(/new\.(\w+)\s+is distinct from/g)].map((m) => m[1]))];
}

/**
 * Часть функции ПОСЛЕ раннего выхода — там, где живут проверки прав.
 * Искать ветку во всём теле нельзя: имя колонки встречается и в самом
 * `v_guarded`, и сторож зеленел бы от собственного перечисления.
 */
function afterEarlyExit(body: string): string {
  const marker = 'if not v_guarded then';
  const i = body.indexOf(marker);
  expect(i, 'в страже нет раннего выхода по v_guarded').toBeGreaterThan(-1);
  const j = body.indexOf('end if;', i);
  return body.slice(j);
}

describe('erp_stage_guard: охраняемые колонки', () => {
  const body = guardBody();
  const columns = guardedColumns(body);
  const checks = afterEarlyExit(body);

  it('список охраняемых колонок разобран — иначе сторож зелен впустую', () => {
    expect(columns.length).toBeGreaterThanOrEqual(20);
    expect(columns).toContain('depends_on');
    expect(columns).toContain('item_id');
    expect(columns).toContain('sort_order');
  });

  it.each(columns)('%s: есть ветка проверки либо названная причина её отсутствия', (col) => {
    const mentioned = new RegExp(`new\\.${col}\\b`).test(checks);
    if (mentioned) return;
    expect(
      NO_BRANCH[col],
      `колонка ${col} доходит до проверок, но ни одна ветка её не смотрит: `
      + 'изменение только этой колонки проходит стража насквозь. Заведите ветку '
      + `или впишите ${col} в NO_BRANCH с причиной`,
    ).toBeTypeOf('string');
  });

  it('граф маршрута и позиция этапа — под order.manage', () => {
    // Ровно то право, что у соседнего `sort_order`: маршрут правит конструктор,
    // а не цех со своего экрана
    const branch = checks.match(
      /if \(new\.depends_on is distinct from old\.depends_on[\s\S]{0,400}?end if;/,
    );
    expect(branch, 'нет ветки для depends_on/item_id').toBeTruthy();
    expect(branch![0]).toContain('new.item_id is distinct from old.item_id');
    expect(branch![0]).toContain("erp_has_permission('order.manage')");
    // Перенос между цехами законно правит `depends_on` — без пропуска
    // `erp_stage_move_department` отказывал бы сам себе
    expect(branch![0]).toContain('v_moving');
  });

  it('причины в NO_BRANCH — объяснения, а не отписки', () => {
    for (const [col, why] of Object.entries(NO_BRANCH)) {
      expect(columns, `${col} больше не охраняется — уберите его из NO_BRANCH`).toContain(col);
      expect(why.length, `причина у ${col} слишком короткая`).toBeGreaterThan(40);
    }
  });
});
