import { describe, it, expect } from 'vitest';
import { functionBody, latestDefining, latestMatching } from './migrations.testutil';

/**
 * Страж этапов и новые колонки исполнителя.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ СТОРОЖ. У `erp_stage_guard` есть ранний выход
 * `if not v_guarded then return new`, и он стоит ВЫШЕ и проверки прав, и проверки
 * цеха. Колонка, не вписанная в `v_guarded`, не проверяется вообще ничем — при
 * этом сам страж выглядит работающим, а тесты на права проходят. Ровно так
 * 10.08 нашлись `cycle` и `origin`: подменённый `cycle` ломал поиск целевого
 * этапа при переносе, а `origin`, переписанный с «образца» на «производство»,
 * обходил узкую ветку политики вставки.
 *
 * Цена промаха с `executor` больше: кто угодно с любым правом на этапы объявил бы
 * чужую работу подрядной — или наоборот, забрал бы подрядный этап в свой цех.
 */

const GUARD_SQL = latestDefining('erp_stage_guard');
const GUARD = functionBody(GUARD_SQL, 'erp_stage_guard');
const MOVE = functionBody(latestDefining('erp_stage_move_department'), 'erp_stage_move_department');

describe('страж этапов знает про исполнителя', () => {
  it('executor, contractor и operation охраняются (иначе ранний выход их пропустит)', () => {
    for (const col of ['executor', 'contractor', 'operation']) {
      expect(
        GUARD,
        `колонки ${col} нет в v_guarded — страж пропустит её изменение без единой проверки`,
      ).toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    }
    // Все три обязаны стоять ДО раннего выхода, а не где-то ниже
    const exit = GUARD.indexOf('if not v_guarded then');
    expect(exit).toBeGreaterThan(0);
    for (const col of ['executor', 'contractor', 'operation']) {
      expect(GUARD.indexOf(`new.${col}`)).toBeLessThan(exit);
    }
  });

  it('смена исполнителя — решение по маршруту, то есть order.manage', () => {
    expect(GUARD).toMatch(/исполнитель этапа требует права order\.manage/);
  });

  /**
   * `sort_order` был в `v_guarded` с самого начала, но СВОЕЙ ветки не имел:
   * его менял любой, у кого есть хоть одно право `stage.*` и принадлежность
   * цеху. Пока порядок этапов задавался только при создании, это было
   * безобидно; с конструктором маршрута — уже нет.
   */
  it('порядок этапов маршрута — тоже order.manage', () => {
    expect(GUARD).toMatch(/порядок этапов маршрута требует права order\.manage/);
  });

  /**
   * Подрядный этап нашему цеху не принадлежит: работать в нём некому, и
   * `erp_can_act_in_dept` к нему неприменима. Иначе менеджер, который ведёт
   * подряд, упирался бы в «задание другого цеха изменить нельзя».
   */
  it('к подрядному этапу проверка «свой ли цех» не применяется', () => {
    expect(GUARD).toMatch(/v_outsourced\s*:=[\s\S]{0,160}'contractor'/);
    expect(GUARD).toMatch(/подрядный этап ведёт менеджер заказа/);
    // Проверка цеха осталась для НАШИХ этапов — второй веткой того же условия
    expect(GUARD).toMatch(/elsif not v_moving and not public\.erp_can_act_in_dept/);
  });

  it('«Задержка/проблема» на подряде доступна тому, кто её обнаружил', () => {
    // blocked — общий механизм остановки; отдельной фазой задержку не заводим
    expect(GUARD).toMatch(/order\.manage'\) or v_block or v_moving/);
  });

  /**
   * Перенос между цехами ищет целевой этап среди НАШИХ. Без этого он «оживил» бы
   * подрядный этап того же цеха вместо создания своего — та же ловушка, которую
   * шапка миграции 20260810180000 описывает про `cycle`.
   */
  it('перенос между цехами не забирает подрядный этап', () => {
    expect(MOVE).toMatch(/coalesce\(executor, 'internal'\) = 'internal'/);
  });
});

/**
 * Появление и удаление этапов. INSERT гейтится политикой (страж работает только
 * на UPDATE), DELETE — тоже: условие «этап без факта» обязано стоять В ПОЛИТИКЕ,
 * иначе менеджер сотрёт этап с проделанной работой прямым запросом.
 */
describe('политики появления и удаления этапов', () => {
  // Политики создаются `create policy`, а не `create or replace function` —
  // берём последнюю миграцию, которая их пересоздаёт
  const SQL = latestMatching(
    /create policy erp_item_stages_insert/, 'политику вставки этапов');
  const DEL = latestMatching(
    /create policy erp_item_stages_delete/, 'политику удаления этапов');

  it('подрядный этап заводится только решением по маршруту', () => {
    // Перенос и задача образца сужены до внутренних: иначе диспетчер заводил бы
    // подряд переносом, а технолог — задачей разработки
    expect(SQL).toMatch(/erp_item_stages_insert[\s\S]*order\.manage/);
    expect(SQL).toMatch(/coalesce\(executor, 'internal'\) = 'internal'[\s\S]{0,120}stage\.move_department/);
    expect(SQL).toMatch(/coalesce\(executor, 'internal'\) = 'internal'[\s\S]{0,160}experimental\.manage/);
  });

  it('удалить можно только этап БЕЗ факта — и это проверяет сама политика', () => {
    expect(DEL).toMatch(/erp_item_stages_delete/);
    expect(DEL).toMatch(/qty_done, 0\) = 0/);
    expect(DEL).toMatch(/qty_rework, 0\) = 0/);
    expect(DEL).toMatch(/started_at is null/);
    expect(DEL).toMatch(/status in \('waiting', 'ready'\)/);
    // Админ остаётся как был: политика РАСШИРЕНА, а не заведена заново
    expect(DEL).toMatch(/public\.is_admin\(\)/);
  });
});
