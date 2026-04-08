import { ROUTE_TEMPLATES } from './workshops.js';
import { ORDERS } from './orders.js';
import { WORKERS } from './workers.js';

// Генерируем задачи из заказов и их маршрутов
// Каждый заказ на разной стадии производства

const TASK_OVERRIDES = {
  // PH-1042 (200 футболок, screen) — шелкография готова к работе
  o1: { cutting: 'done', screen: 'ready', sewing: 'pending', packaging_qc: 'pending' },
  // PH-1089 (50 худи, embroidery) — пошив в работе
  o2: { cutting: 'done', sewing: 'in_progress', embroidery: 'pending', packaging_qc: 'pending' },
  // PH-1091 (100 футболок, DTF) — DTF в работе
  o3: { cutting: 'done', dtf: 'in_progress', sewing: 'pending', packaging_qc: 'pending' },
  // PH-1095 (80 свитшотов, no print) — раскрой в работе
  o4: { cutting: 'in_progress', sewing: 'pending', packaging_qc: 'pending' },
  // PH-1098 (150 футболок, screen) — ПРОСРОЧЕН, шелкография blocked
  o5: { cutting: 'done', screen: 'blocked', sewing: 'pending', packaging_qc: 'pending' },
  // PH-1100 (300 футболок, screen) — раскрой готов
  o6: { cutting: 'ready', screen: 'pending', sewing: 'pending', packaging_qc: 'pending' },
  // PH-1103 (60 лонгсливов, DTF) — всё сделано кроме упаковки
  o7: { cutting: 'done', dtf: 'done', sewing: 'done', packaging_qc: 'ready' },
  // PH-1105 (40 худи, screen+embroidery) — раскрой в работе
  o8: { cutting: 'in_progress', screen: 'pending', sewing: 'pending', embroidery: 'pending', packaging_qc: 'pending' },
  // PH-1108 (500 футболок, screen) — только начали, раскрой ready
  o9: { cutting: 'ready', screen: 'pending', sewing: 'pending', packaging_qc: 'pending' },
  // PH-1110 (25 футболок, embroidery) — вышивка ready
  o10: { cutting: 'done', sewing: 'done', embroidery: 'ready', packaging_qc: 'pending' },
  // PH-1112 (120 футболок, screen) — полностью done
  o11: { cutting: 'done', screen: 'done', sewing: 'done', packaging_qc: 'done' },
  // PH-1115 (75 шорт, no print) — пошив ready
  o12: { cutting: 'done', sewing: 'ready', packaging_qc: 'pending' },
};

const HANDOFF_NOTES = {
  o1: { cutting: '200 шт, всё ОК. Ткань без дефектов.' },
  o2: { cutting: '50 шт готово. Капюшоны отдельно.' },
  o3: { cutting: '100 шт нарезано. Внимание: тёмно-синий, проверьте партию.' },
  o5: { cutting: '150 шт. Три рукава — ткань с дефектом, подрезал на 1 см.' },
  o7: { cutting: '60 шт ОК', dtf: 'Перенос ОК, один брак — перепечатал', sewing: '60 шт пошито, этикетки пришиты' },
  o10: { cutting: '25 шт', sewing: '25 шт пошито, готово к вышивке' },
  o11: { cutting: '120 шт', screen: 'Печать 2 цвета ОК', sewing: '120 шт готово', packaging_qc: 'Упаковано, ОТК пройден' },
  o12: { cutting: '75 шт нарезано' },
};

const TIMESTAMPS = {
  o1: { cutting: { started: '2026-04-07T08:30:00', completed: '2026-04-07T16:00:00' } },
  o2: { cutting: { started: '2026-04-07T09:00:00', completed: '2026-04-07T14:00:00' }, sewing: { started: '2026-04-08T08:00:00' } },
  o3: { cutting: { started: '2026-04-07T10:00:00', completed: '2026-04-07T15:30:00' }, dtf: { started: '2026-04-08T08:30:00' } },
  o4: { cutting: { started: '2026-04-08T07:30:00' } },
  o5: { cutting: { started: '2026-04-06T08:00:00', completed: '2026-04-06T16:00:00' } },
  o7: {
    cutting: { started: '2026-04-05T08:00:00', completed: '2026-04-05T12:00:00' },
    dtf: { started: '2026-04-05T13:00:00', completed: '2026-04-06T11:00:00' },
    sewing: { started: '2026-04-06T12:00:00', completed: '2026-04-07T16:00:00' },
  },
  o8: { cutting: { started: '2026-04-08T09:00:00' } },
  o10: {
    cutting: { started: '2026-04-06T08:00:00', completed: '2026-04-06T10:00:00' },
    sewing: { started: '2026-04-06T11:00:00', completed: '2026-04-07T12:00:00' },
  },
  o11: {
    cutting: { started: '2026-04-04T08:00:00', completed: '2026-04-04T14:00:00' },
    screen: { started: '2026-04-04T15:00:00', completed: '2026-04-05T16:00:00' },
    sewing: { started: '2026-04-06T08:00:00', completed: '2026-04-07T12:00:00' },
    packaging_qc: { started: '2026-04-07T13:00:00', completed: '2026-04-07T16:00:00' },
  },
  o12: { cutting: { started: '2026-04-07T08:00:00', completed: '2026-04-07T11:00:00' } },
};

let taskId = 0;

function generateTasks() {
  const tasks = [];

  for (const order of ORDERS) {
    const route = ROUTE_TEMPLATES[order.route];
    const overrides = TASK_OVERRIDES[order.id] || {};
    const notes = HANDOFF_NOTES[order.id] || {};
    const times = TIMESTAMPS[order.id] || {};

    route.forEach((workshopCode, idx) => {
      taskId++;
      const status = overrides[workshopCode] || 'pending';
      const ts = times[workshopCode] || {};

      tasks.push({
        id: `t${taskId}`,
        order_id: order.id,
        workshop_code: workshopCode,
        seq: idx + 1,
        status,
        total_units: order.total_qty,
        planned_date: order.data.deadline,
        due_date: order.data.deadline,
        started_at: ts.started || null,
        completed_at: ts.completed || null,
        handoff_note: notes[workshopCode] || null,
        problem_type: status === 'blocked' ? 'design' : null,
        problem_note: status === 'blocked' ? 'Макет не подходит под формат сетки, нужна коррекция от дизайнера' : null,
        assigned_to: status === 'in_progress' ? (WORKERS.find(w => w.workshop === workshopCode)?.id || null) : null,
      });
    });
  }

  return tasks;
}

export const TASKS = generateTasks();
