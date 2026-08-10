import { describe, it, expect } from 'vitest';
import {
  daysLeft, formatDateHuman, formatDateShort, formatTimeIn, isUrgent, isOverdue,
  procurementSla, shiftIsoDate, subcontractOverdue, stageOverdue,
} from './time';

describe('stageOverdue — просрочка этапа по planned_end (правка 8)', () => {
  const now = new Date('2026-07-20T12:00:00');
  it('planned_end в прошлом и этап не завершён → просрочен', () => {
    expect(stageOverdue('2026-07-18', 'in_progress', now)).toBe(true);
    expect(stageOverdue('2026-07-18', 'waiting', now)).toBe(true);
  });
  it('завершённый/пропущенный этап не считается просроченным', () => {
    expect(stageOverdue('2026-07-18', 'done', now)).toBe(false);
    expect(stageOverdue('2026-07-18', 'skipped', now)).toBe(false);
  });
  it('план в будущем или отсутствует → не просрочен', () => {
    expect(stageOverdue('2026-07-25', 'in_progress', now)).toBe(false);
    expect(stageOverdue(null, 'in_progress', now)).toBe(false);
  });
});

describe('daysLeft — дней до срока клиента (единый хелпер экранов)', () => {
  const now = new Date('2026-07-17T15:30:00');

  it('null/пусто → null', () => {
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft(undefined, now)).toBeNull();
    expect(daysLeft('', now)).toBeNull();
  });

  it('сегодня → 0, будущее → положительное', () => {
    expect(daysLeft('2026-07-17', now)).toBe(0);
    expect(daysLeft('2026-07-20', now)).toBe(3);
  });

  it('просроченный срок → отрицательное', () => {
    expect(daysLeft('2026-07-15', now)).toBe(-2);
  });
});

describe('isUrgent / isOverdue — фильтры сроков (дашборд ↔ чипы заказов)', () => {
  const now = new Date('2026-07-17T15:30:00');

  it('isUrgent: 0–3 дня включительно', () => {
    expect(isUrgent('2026-07-17', now)).toBe(true);  // сегодня (0)
    expect(isUrgent('2026-07-20', now)).toBe(true);  // ровно 3 дня
    expect(isUrgent('2026-07-21', now)).toBe(false); // 4 дня — не горит
  });

  it('isUrgent: просроченный и пустой срок не считаются горящими', () => {
    expect(isUrgent('2026-07-15', now)).toBe(false);
    expect(isUrgent(null, now)).toBe(false);
    expect(isUrgent(undefined, now)).toBe(false);
  });

  it('isOverdue: только даты в прошлом', () => {
    expect(isOverdue('2026-07-16', now)).toBe(true);
    expect(isOverdue('2026-07-17', now)).toBe(false); // сегодня — ещё не просрочен
    expect(isOverdue('2026-07-18', now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });

  it('urgent и overdue взаимоисключающие — счётчики дашборда не пересекаются', () => {
    for (const d of ['2026-07-10', '2026-07-17', '2026-07-19', '2026-08-01']) {
      expect(isUrgent(d, now) && isOverdue(d, now)).toBe(false);
    }
  });
});

describe('formatTimeIn — «время в этапе» (механика kontora24)', () => {
  const now = new Date('2026-07-17T12:00:00Z').getTime();

  it('минуты до часа', () => {
    expect(formatTimeIn('2026-07-17T11:45:00Z', now)).toBe('15 мин');
  });

  it('часы до суток', () => {
    expect(formatTimeIn('2026-07-17T07:00:00Z', now)).toBe('5 ч');
  });

  it('дни от суток', () => {
    expect(formatTimeIn('2026-07-14T12:00:00Z', now)).toBe('3 дн');
  });

  it('null → пустая строка', () => {
    expect(formatTimeIn(null, now)).toBe('');
  });

  it('меньше минуты → «только что»', () => {
    expect(formatTimeIn('2026-07-17T11:59:40Z', now)).toBe('только что');
  });
});

describe('procurementSla — SLA первичной обработки закупки (3 дня)', () => {
  const now = new Date('2026-07-19T12:00:00');

  it('pending старше 3 дней → overdue', () => {
    expect(procurementSla('2026-07-14T10:00:00', 'pending', now)).toBe('overdue'); // 5 дней
  });

  it('pending в пределах 3 дней → processing', () => {
    expect(procurementSla('2026-07-18T10:00:00', 'pending', now)).toBe('processing'); // 1 день
    expect(procurementSla('2026-07-16T10:00:00', 'pending', now)).toBe('processing'); // 3 дня — ещё не просрочен
  });

  it('обработанные статусы → null', () => {
    for (const st of ['ordered', 'in_transit', 'received', 'reserved', 'not_needed', 'partial']) {
      expect(procurementSla('2026-07-01', st, now)).toBeNull();
    }
  });

  it('без даты создания → processing', () => {
    expect(procurementSla(null, 'pending', now)).toBe('processing');
  });
});

describe('subcontractOverdue — просрочка операции подряда', () => {
  const today = '2026-07-19';

  it('план в прошлом и не возвращено → просрочено', () => {
    expect(subcontractOverdue('2026-07-15', null, 'sent', today)).toBe(true);
  });

  /**
   * Терминальные ФАЗЫ (волна 3.5). Прежде здесь перечислялись значения
   * устаревшего `status` — в том числе `cancelled`, которого в фазах нет:
   * отменённая операция закрывается фазой `closed`.
   */
  it('вернулось, принято или закрыто → не просрочено', () => {
    expect(subcontractOverdue('2026-07-15', '2026-07-18', 'returned', today)).toBe(false);
    expect(subcontractOverdue('2026-07-15', null, 'returned', today)).toBe(false);
    expect(subcontractOverdue('2026-07-15', null, 'accepted', today)).toBe(false);
    expect(subcontractOverdue('2026-07-15', null, 'closed', today)).toBe(false);
  });

  it('у подрядчика и срок прошёл → просрочено', () => {
    expect(subcontractOverdue('2026-07-15', null, 'at_contractor', today)).toBe(true);
  });

  it('план в будущем или пустой → не просрочено', () => {
    expect(subcontractOverdue('2026-07-25', null, 'sent', today)).toBe(false);
    expect(subcontractOverdue(null, null, 'sent', today)).toBe(false);
  });
});

describe('formatDateShort — короткая дата ru-RU', () => {
  it('дата без времени не сдвигается', () => {
    expect(formatDateShort('2026-07-20')).toBe('20.07.2026');
  });
  it('null → пустая строка', () => {
    expect(formatDateShort(null)).toBe('');
  });
  it('нераспознаваемая строка → пустая строка, а не «Invalid Date»', () => {
    expect(formatDateShort('не дата')).toBe('');
    expect(formatDateShort('2026-13-99')).toBe('');
  });
});

describe('formatDateHuman — эхо под нативным полем даты', () => {
  it('месяц словом: «08» нельзя спутать с днём', () => {
    // именно этой двусмысленности не видно в mm/dd/yyyy при en-US локали браузера
    expect(formatDateHuman('2026-08-14')).toMatch(/14/);
    expect(formatDateHuman('2026-08-14')).toMatch(/авг/);
    expect(formatDateHuman('2026-08-14')).toMatch(/2026/);
  });

  it('пусто и мусор → пустая строка, а не «Invalid Date»', () => {
    expect(formatDateHuman(null)).toBe('');
    expect(formatDateHuman('')).toBe('');
    expect(formatDateHuman('не дата')).toBe('');
  });

  it('дата без времени не съезжает на сутки', () => {
    expect(formatDateHuman('2026-01-01')).toMatch(/^1 янв/);
  });
});

describe('shiftIsoDate — пресеты сроков', () => {
  it('сдвиг вперёд и назад от заданной базы', () => {
    expect(shiftIsoDate('2026-08-14', 0)).toBe('2026-08-14');
    expect(shiftIsoDate('2026-08-14', 3)).toBe('2026-08-17');
    expect(shiftIsoDate('2026-08-14', -1)).toBe('2026-08-13');
  });

  it('переход через конец месяца и года', () => {
    expect(shiftIsoDate('2026-08-30', 3)).toBe('2026-09-02');
    expect(shiftIsoDate('2026-12-30', 7)).toBe('2027-01-06');
  });

  it('високосный февраль', () => {
    expect(shiftIsoDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftIsoDate('2028-02-28', 2)).toBe('2028-03-01');
  });

  it('база с временем усекается до даты', () => {
    expect(shiftIsoDate('2026-08-14T23:45:00Z', 1)).toBe('2026-08-15');
  });

  it('без базы считает от сегодня', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(shiftIsoDate(null, 0)).toBe(today);
    expect(shiftIsoDate(undefined, 1)).toBe(shiftIsoDate(today, 1));
  });
});
