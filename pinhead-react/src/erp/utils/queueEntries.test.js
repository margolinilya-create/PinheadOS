import { describe, it, expect } from 'vitest';
import { buildQueueEntries } from './queueEntries';

/**
 * Единый источник группы и причины ожидания для очереди цеха, канбана и фильтров.
 * Тестов у него не было, хотя `pinhead-react/CLAUDE.md` называет его единственным
 * местом, где это считается, — и он же держит гейты материалов, закупки и ТЗ.
 */

/**
 * Какие материалы блокируют участок — настройка из данных
 * (`erp_departments.gate_material_kinds`), а не константа в коде. Значения здесь
 * повторяют бэкфилл миграции 20260803120000, чтобы тесты описывали прод.
 */
const DEPTS = [
  { id: 'd-cut', code: 'cutting', name: 'Закройный цех', gate_material_kinds: ['fabric'] },
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', gate_material_kinds: ['hardware', 'labels'] },
  { id: 'd-sup', code: 'supply', name: 'Закупка' },
];

const stage = (over) => ({
  id: 's1',
  item_id: 'it1',
  department_id: 'd-cut',
  depends_on: [],
  status: 'waiting',
  qty_done: 0,
  block_reason: null,
  sort_order: 10,
  ...over,
});

const material = (over) => ({
  id: 'm1',
  kind: 'fabric',
  name: 'Кулирка',
  status: 'ordered',
  eta_date: null,
  accept_status: null,
  ...over,
});

/** Заказ с одной позицией; stages/materials задаются целиком */
const order = (over = {}) => ({
  id: 'o1',
  status: 'active',
  bitrix_id: '100',
  title: 'Заказ',
  due_date: '2026-08-01',
  materials: [],
  procurement_tasks: [],
  items: [{ id: 'it1', qty: 100, product_type: 'Футболка', stages: [stage()] }],
  ...over,
});

const groups = (entries) => entries.map((e) => e.group);
const reasons = (entries) => entries.map((e) => e.reason);

describe('buildQueueEntries — что попадает в список', () => {
  it('архивные заказы в очередь не попадают', () => {
    const done = order({ status: 'done_on_time' });
    expect(buildQueueEntries([done], DEPTS)).toEqual([]);
  });

  it('пропущенные этапы не попадают — это не работа', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [stage({ status: 'skipped' })] }],
    });
    expect(buildQueueEntries([o], DEPTS)).toEqual([]);
  });

  it('этап неизвестного цеха пропускается, а не роняет список', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's1', department_id: 'd-cut' }),
        stage({ id: 's2', department_id: 'd-нет' }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS);
    expect(list.map((e) => e.stage.id)).toEqual(['s1']);
  });

  it('фильтр по цеху оставляет только его этапы', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's-cut', department_id: 'd-cut' }),
        stage({ id: 's-sew', department_id: 'd-sew' }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS, { departmentId: 'd-sew' });
    expect(list.map((e) => e.stage.id)).toEqual(['s-sew']);
  });

  it('в записи лежат заказ, позиция и этап целиком — экранам больше искать нечего', () => {
    const [entry] = buildQueueEntries([order()], DEPTS);
    expect(entry.order.id).toBe('o1');
    expect(entry.item.id).toBe('it1');
    expect(entry.stage.id).toBe('s1');
  });
});

describe('buildQueueEntries — группы', () => {
  it('waiting без незакрытых зависимостей и без гейтов → ready', () => {
    expect(groups(buildQueueEntries([order()], DEPTS))).toEqual(['ready']);
  });

  /**
   * ГРАНИЦА ДВУХ ОЖИДАНИЙ — ПРИЧИНА, А НЕ ЦЕХ (правки 23.08, пп. 2 и 3).
   *
   * Незакрытая ЗАКУПКА — снабжение, поэтому этап уходит в «Ожидают материалы»
   * вместе с нехваткой материалов. До 23.08 он лежал в `waiting`, и у закроя
   * получались ДВЕ группы ожидания об одном и том же снабжении — ровно то,
   * на что жалуется п. 2. Причина при этом не меняется ни на слово.
   */
  it('незавершённая закупка — это ожидание СНАБЖЕНИЯ', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's-sup', department_id: 'd-sup', status: 'in_progress' }),
        stage({ id: 's-cut', department_id: 'd-cut', depends_on: ['s-sup'] }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS, { departmentId: 'd-cut' });
    expect(groups(list)).toEqual(['awaiting_materials']);
    expect(list[0].reason).toBe('Закупка: ещё не завершено');
  });

  /**
   * Обратная половина того же правила, и она важнее прямой: незакрытый
   * ПРОИЗВОДСТВЕННЫЙ цех остаётся в «Ожидает». Именно этого требует п. 3
   * для швейки — «Ожидает» про закрой, ДТФ и вышивку, «Ожидают материалы»
   * про ткань и фурнитуру. Съедь эта граница — швейка получила бы ровно тот
   * экран, который документ просит разделить.
   */
  it('незавершённый производственный цех оставляет этап в «Ожидает»', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's-cut', department_id: 'd-cut', status: 'in_progress' }),
        stage({ id: 's-sew', department_id: 'd-sew', depends_on: ['s-cut'] }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS, { departmentId: 'd-sew' });
    expect(groups(list)).toEqual(['waiting']);
    expect(list[0].reason).toBe('Закройный цех: ещё не завершено');
  });

  it('done и in_progress остаются своими статусами и причины не получают', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's-a', status: 'done' }),
        stage({ id: 's-b', status: 'in_progress' }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS);
    expect(groups(list)).toEqual(['done', 'in_progress']);
    expect(reasons(list)).toEqual([null, null]);
  });

  it('blocked отдаёт причину цеха, а без неё — общий текст', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's-a', status: 'blocked', block_reason: 'Сломалась машина' }),
        stage({ id: 's-b', status: 'blocked', block_reason: null }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS);
    expect(groups(list)).toEqual(['blocked', 'blocked']);
    expect(reasons(list)).toEqual(['Сломалась машина', 'Заблокирован цехом']);
  });
});

describe('buildQueueEntries — гейт материалов', () => {
  it('непришедшая ткань держит закрой в своей группе и называет материал', () => {
    const o = order({ materials: [material({ status: 'ordered', eta_date: '2026-07-30' })] });
    const list = buildQueueEntries([o], DEPTS, { departmentId: 'd-cut' });
    // Отдельная группа, а не общий «Ожидает»: «ждём ткань» и «швейка ещё не сдала»
    // требуют разных решений руководителя (правка менеджера 2026-08-03)
    expect(groups(list)).toEqual(['awaiting_materials']);
    expect(list[0].reason).toContain('Ждём материалы: Кулирка');
    // Список нужен карточке, чтобы показать ETA и ответственного
    expect(list[0].missingMaterials.map((m) => m.name)).toEqual(['Кулирка']);
  });

  it('ожидание предыдущего этапа остаётся в «Ожидает», а не в материалах', () => {
    const o = order({
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's-cut', department_id: 'd-cut', status: 'in_progress' }),
        stage({ id: 's-sew', department_id: 'd-sew', depends_on: ['s-cut'] }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS, { departmentId: 'd-sew' });
    expect(groups(list)).toEqual(['waiting']);
    expect(list[0].missingMaterials).toEqual([]);
  });

  it('участок без настройки материалами не гейтится — блокировка fail-open', () => {
    // gate_material_kinds не задан: непришедшая ткань не должна остановить ВТО,
    // про которое производство ещё не решило, чего оно ждёт
    const vto = [{ id: 'd-vto', code: 'vto', name: 'ВТО' }];
    const o = order({
      materials: [material({ status: 'ordered' })],
      items: [{ id: 'it1', qty: 100, stages: [stage({ department_id: 'd-vto' })] }],
    });
    expect(groups(buildQueueEntries([o], vto))).toEqual(['ready']);
  });

  it('вид материала берётся из настройки участка, а не из кода', () => {
    // Шелкографии заводят «прочее» (плёнка) — гейт обязан сработать без релиза
    const silk = [{ id: 'd-silk', code: 'silkscreen', name: 'Шелкография', gate_material_kinds: ['other'] }];
    const o = order({
      materials: [material({ kind: 'other', name: 'Плёнка', status: 'ordered' })],
      items: [{ id: 'it1', qty: 100, stages: [stage({ department_id: 'd-silk' })] }],
    });
    const list = buildQueueEntries([o], silk);
    expect(groups(list)).toEqual(['awaiting_materials']);
    expect(list[0].missingMaterials.map((m) => m.name)).toEqual(['Плёнка']);
  });

  it('пришедшая, но не принятая складом ткань — «ожидает приёмки»', () => {
    const o = order({ materials: [material({ status: 'received', accept_status: null })] });
    const list = buildQueueEntries([o], DEPTS, { departmentId: 'd-cut' });
    expect(list[0].reason).toBe('Ожидает приёмки складом: Кулирка');
  });

  it('принятая ткань закрой отпускает', () => {
    const o = order({
      materials: [material({ status: 'received', accept_status: 'accepted_full' })],
    });
    expect(groups(buildQueueEntries([o], DEPTS, { departmentId: 'd-cut' }))).toEqual(['ready']);
  });

  it('ткань гейтит закрой, но не швейку — у каждого цеха свои материалы', () => {
    const o = order({
      materials: [material({ status: 'ordered' })],
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ id: 's-cut', department_id: 'd-cut' }),
        stage({ id: 's-sew', department_id: 'd-sew' }),
      ] }],
    });
    const list = buildQueueEntries([o], DEPTS);
    expect(groups(list)).toEqual(['awaiting_materials', 'ready']);
  });
});

describe('buildQueueEntries — гейт закупки', () => {
  it('открытая задача закупки на этап держит его — как ожидание снабжения', () => {
    const o = order({
      procurement_tasks: [{ id: 'p1', source_stage_id: 's1', status: 'new' }],
    });
    const list = buildQueueEntries([o], DEPTS);
    // Закупка на замену — то же снабжение, что нехватка материалов (правка 23.08)
    expect(groups(list)).toEqual(['awaiting_materials']);
    expect(list[0].reason).toBe('Ожидает закупку материала на замену');
  });

  it('закрытая задача закупки этап отпускает', () => {
    const o = order({
      procurement_tasks: [{ id: 'p1', source_stage_id: 's1', status: 'done' }],
    });
    expect(groups(buildQueueEntries([o], DEPTS))).toEqual(['ready']);
  });
});

describe('buildQueueEntries — гейт ТЗ (волна 4)', () => {
  const withTz = (extra) => order({
    tz_required: true,
    tz_documents: [],
    tz_assignments: [],
    ...extra,
  });

  it('производственный цех без назначенного ТЗ не запускается', () => {
    const list = buildQueueEntries([withTz()], DEPTS, { departmentId: 'd-cut' });
    expect(groups(list)).toEqual(['waiting']);
    expect(list[0].reason).toBe('Не назначено ТЗ');
  });

  it('назначенное ТЗ этап отпускает', () => {
    const o = withTz({
      tz_documents: [{
        id: 'd1', order_id: 'o1', item_id: null, group_id: 'g1',
        version: 1, is_current: true, file_path: 'p', created_at: '2026-07-20T10:00:00Z',
      }],
      tz_assignments: [{
        id: 'a1', order_id: 'o1', item_id: 'it1', department_id: 'd-cut', group_id: 'g1',
        created_at: '2026-07-20T10:00:00Z',
      }],
    });
    expect(groups(buildQueueEntries([o], DEPTS, { departmentId: 'd-cut' }))).toEqual(['ready']);
  });

  it('закупка ТЗ не требует — гейт её не трогает', () => {
    const o = withTz({
      items: [{ id: 'it1', qty: 100, stages: [stage({ department_id: 'd-sup' })] }],
    });
    expect(groups(buildQueueEntries([o], DEPTS, { departmentId: 'd-sup' }))).toEqual(['ready']);
  });

  it('заказ, заведённый до внедрения ТЗ, гейтом не трогается', () => {
    const o = order({ tz_required: false, tz_documents: [], tz_assignments: [] });
    expect(groups(buildQueueEntries([o], DEPTS, { departmentId: 'd-cut' }))).toEqual(['ready']);
  });
});

describe('buildQueueEntries — приоритет причин', () => {
  it('ручная блокировка перебивает материалы: цех сам сказал, в чём дело', () => {
    const o = order({
      materials: [material({ status: 'ordered' })],
      items: [{ id: 'it1', qty: 100, stages: [
        stage({ status: 'blocked', block_reason: 'Брак ткани' }),
      ] }],
    });
    expect(buildQueueEntries([o], DEPTS)[0].reason).toBe('Брак ткани');
  });

  it('закупка перебивает материалы: задача на замену конкретнее', () => {
    const o = order({
      materials: [material({ status: 'ordered' })],
      procurement_tasks: [{ id: 'p1', source_stage_id: 's1', status: 'new' }],
    });
    expect(buildQueueEntries([o], DEPTS)[0].reason)
      .toBe('Ожидает закупку материала на замену');
  });
});
