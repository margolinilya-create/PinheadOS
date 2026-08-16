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

/**
 * Маршрут, собранный в форме СОЗДАНИЯ заказа.
 *
 * Секция `stages` payload-а принимала только цех, порядок и зависимости, и
 * подрядный этап, заданный конструктором до создания заказа, становился нашим —
 * молча, без единой ошибки. Ошибка этого рода не падает: заказ создаётся,
 * выглядит правильно и просто уходит не тому исполнителю.
 */
describe('erp_create_order принимает исполнителя этапа', () => {
  const SQL = functionBody(latestDefining('erp_create_order'), 'erp_create_order');

  it('вставка этапа читает executor, contractor и operation', () => {
    for (const col of ['executor', 'contractor', 'operation']) {
      expect(SQL, `секция stages не читает ${col}`).toMatch(new RegExp(`v_stage->>'${col}'`));
    }
    // Отсутствие поля означает НАШ этап: колонка новая, и payload старого
    // бандла её не несёт вовсе — fail-open обязателен именно в эту сторону
    expect(SQL).toMatch(/coalesce\(v_stage->>'executor', 'internal'\)/);
  });

  /**
   * Карточку подрядчика заводит тот же оператор, что и этап. Второго писателя
   * связи `stage_id` быть не должно — именно её отсутствие (на боевой базе обе
   * строки подряда с `null`) и делало раздел «Подряд» тупиком.
   */
  it('подрядный этап заводит карточку подрядчика той же транзакцией', () => {
    expect(SQL).toMatch(/insert into erp_subcontracting[\s\S]{0,200}stage_id/);
  });
});

/**
 * Перечисление, разъехавшееся между двумя таблицами.
 *
 * `mixed` завели в `erp_subcontracting`, а выбирает источник менеджер В ФОРМЕ
 * ЗАКАЗА — то есть значение пишется прежде всего в `erp_order_items`, где CHECK
 * остался на двух значениях. Заказ со смешанными материалами не создавался
 * вовсе: 23514 на вставке позиции, ещё до единого этапа. В клиенте перечисление
 * ОДНО на оба поля, поэтому ни типы, ни тесты маршрута расхождения не видели.
 */
describe('источник материалов совпадает у позиции и у карточки подряда', () => {
  const VALUES = ['pinhead', 'contractor', 'mixed'];

  // Привязываемся к ИМЕНИ КОНСТРЕЙНТА и берём текст CHECK сразу за ним:
  // просто «в файле есть слово material_source» найдёт любую соседнюю миграцию,
  // и сторож станет зелёным независимо от того, что сторожит
  it.each([
    ['erp_order_items', 'erp_order_items_material_source_check'],
    ['erp_subcontracting', 'erp_subcontracting_material_source_check'],
  ])('%s принимает все три значения', (table, constraint) => {
    const sql = latestMatching(
      new RegExp(`add constraint ${constraint}`), `CHECK material_source у ${table}`);
    const check = sql.match(
      new RegExp(`add constraint ${constraint}\\s+check \\(([^)]*\\))`))?.[1] ?? '';
    for (const v of VALUES) {
      expect(check, `в CHECK ${constraint} нет значения ${v}`).toContain(`'${v}'`);
    }
  });
});
