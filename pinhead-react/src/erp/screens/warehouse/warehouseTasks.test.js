import { describe, it, expect } from 'vitest';
import {
  TABS, deadlineLabel, isTaskInTab, matchesDue, matchesTaskQuery, orderDueNote,
  receiptQtyLabel, taskActionLabel, taskDeadline,
} from './warehouseTasks';

/**
 * Рабочий экран склада (правка заказчика 05.10, п. 8): вкладки по операциям,
 * действие называет себя, поиск по содержимому задачи, срок поставки
 * у приёмки и фильтр по срокам.
 */

const FABRIC = {
  id: 'm1', kind: 'fabric', name: 'Тест новый', color: 'чёрный', unit: 'кг',
  supplier: 'Астра Текстиль', qty_expected: 100, qty_received: 40, eta_date: '2026-10-07',
};
const LABELS = { ...FABRIC, id: 'm2', kind: 'labels', name: 'Бирки', eta_date: null };

const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', due_date: '2026-10-20',
  materials: [FABRIC, LABELS], items: [],
};

const task = (type, patch = {}) => ({ id: `t-${type}`, task_type: type, status: 'awaiting', deadline: null, ...patch });

describe('вкладки склада', () => {
  it('каждый тип задачи — ровно в одной рабочей вкладке', () => {
    const types = ['material_receipt', 'fg_receipt', 'marking', 'subcontract_send', 'subcontract_receipt', 'pack_ship'];
    for (const type of types) {
      const hits = TABS.filter((t) => t.types?.includes(type));
      expect(hits.map((t) => t.key), type).toHaveLength(1);
    }
  });

  it('в приёмке материалов нет отгрузок и приёмок готовых изделий', () => {
    expect(isTaskInTab(task('material_receipt'), 'materials')).toBe(true);
    expect(isTaskInTab(task('pack_ship'), 'materials')).toBe(false);
    expect(isTaskInTab(task('fg_receipt'), 'materials')).toBe(false);
  });

  it('маркировка — внутри готовых изделий; «Все» показывает всё; мусор в адресе — «Все»', () => {
    expect(isTaskInTab(task('marking'), 'goods')).toBe(true);
    expect(isTaskInTab(task('pack_ship'), 'all')).toBe(true);
    expect(isTaskInTab(task('pack_ship'), 'нет-такой')).toBe(true);
  });
});

describe('действие называет себя', () => {
  it.each([
    [task('material_receipt', { material_id: 'm1' }), 'Принять ткань'],
    [task('material_receipt', { material_id: 'm2' }), 'Принять материал'],
    [task('material_receipt'), 'Принять материал'],
    [task('fg_receipt'), 'Принять изделия'],
    [task('subcontract_send', { status: 'new' }), 'Передать подрядчику'],
    [task('pack_ship', { status: 'ready_to_ship' }), 'Отгрузить'],
  ])('%#: %s', (t, label) => {
    expect(taskActionLabel(ORDER, t)).toBe(label);
  });

  it('закрытая задача — «Открыть»: принимать второй раз нечего', () => {
    expect(taskActionLabel(ORDER, task('material_receipt', { material_id: 'm1', status: 'accepted' })))
      .toBe('Открыть');
    expect(taskActionLabel(ORDER, task('pack_ship', { status: 'shipped' }))).toBe('Открыть');
  });
});

describe('срок поставки у приёмки материала', () => {
  it('срок — дата поставки позиции, а срок заказа отдельной подписью', () => {
    const t = task('material_receipt', { material_id: 'm1' });
    expect(taskDeadline(ORDER, t)).toEqual({ date: '2026-10-07', kind: 'eta' });
    expect(deadlineLabel(ORDER, t)).toBe('07.10.2026');
    expect(orderDueNote(ORDER, t)).toBe('срок заказа 20.10.2026');
  });

  it('без даты поставки — «не задан», а не срок заказа', () => {
    const t = task('material_receipt', { material_id: 'm2' });
    expect(deadlineLabel(ORDER, t)).toBe('не задан');
    expect(orderDueNote(ORDER, t)).toBe('срок заказа 20.10.2026');
  });

  it('у остальных задач — свой срок либо срок заказа с подписью', () => {
    expect(deadlineLabel(ORDER, task('pack_ship', { deadline: '2026-10-09' }))).toBe('09.10.2026');
    expect(deadlineLabel(ORDER, task('pack_ship'))).toBe('20.10.2026 · срок заказа');
    expect(orderDueNote(ORDER, task('pack_ship'))).toBe('');
  });

  it('к приёмке — остаток позиции с единицей', () => {
    expect(receiptQtyLabel(ORDER, task('material_receipt', { material_id: 'm1' }))).toBe('60 кг');
    expect(receiptQtyLabel(ORDER, task('pack_ship'))).toBeNull();
  });
});

describe('фильтр по срокам', () => {
  const TODAY = '2026-10-05';
  const due = (date) => task('pack_ship', { deadline: date });

  it('просрочено — раньше сегодня', () => {
    expect(matchesDue(ORDER, due('2026-10-04'), 'overdue', TODAY)).toBe(true);
    expect(matchesDue(ORDER, due('2026-10-05'), 'overdue', TODAY)).toBe(false);
  });

  it('3 дня и неделя — окно вперёд от сегодня, без просроченного', () => {
    expect(matchesDue(ORDER, due('2026-10-08'), 'd3', TODAY)).toBe(true);
    expect(matchesDue(ORDER, due('2026-10-09'), 'd3', TODAY)).toBe(false);
    expect(matchesDue(ORDER, due('2026-10-12'), 'week', TODAY)).toBe(true);
    expect(matchesDue(ORDER, due('2026-10-04'), 'week', TODAY)).toBe(false);
  });

  it('задача без срока в фильтры по срокам не попадает', () => {
    const t = task('material_receipt', { material_id: 'm2' });
    expect(matchesDue(ORDER, t, 'week', TODAY)).toBe(false);
    expect(matchesDue(ORDER, t, '', TODAY)).toBe(true);
  });
});

describe('поиск по содержимому задачи', () => {
  it('находит по названию материала, а не только по заказу', () => {
    const t = task('material_receipt', { material_id: 'm1' });
    expect(matchesTaskQuery(ORDER, t, 'тест новый')).toBe(true);
    expect(matchesTaskQuery(ORDER, t, 'астра')).toBe(true);
    expect(matchesTaskQuery(ORDER, t, '4821')).toBe(true);
    expect(matchesTaskQuery(ORDER, t, 'zzz')).toBe(false);
  });

  it('приёмка другой позиции того же заказа по чужому материалу не находится', () => {
    // Иначе «Тест новый» находил бы все приёмки заказа, и нужная терялась бы на страницах
    expect(matchesTaskQuery(ORDER, task('material_receipt', { material_id: 'm2' }), 'тест новый')).toBe(false);
  });
});
