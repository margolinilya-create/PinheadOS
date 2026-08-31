import { describe, expect, it } from 'vitest';
import { defaultPlannedEnd, unplannedStages } from './stagePlan';

/**
 * Тесты дат идут в поясе заказчика — правило проекта: в UTC-контейнере сдвиг
 * равен нулю и проходит ЛЮБАЯ реализация.
 */
process.env.TZ = 'Europe/Moscow';

const TODAY = '2026-08-24';

describe('defaultPlannedEnd', () => {
  it('свой план этапа сильнее любого расчёта', () => {
    expect(defaultPlannedEnd({
      plannedEnd: '2026-09-01', normDays: 3, dueDate: '2026-08-30',
    }, TODAY)).toBe('2026-09-01');
  });

  it('без плана берёт норматив участка от сегодня', () => {
    expect(defaultPlannedEnd({ normDays: 3, dueDate: '2026-09-30' }, TODAY))
      .toBe('2026-08-27');
  });

  it('норматив 0 или пустой норматив не считается заданным', () => {
    expect(defaultPlannedEnd({ normDays: 0, dueDate: '2026-08-30' }, TODAY))
      .toBe('2026-08-30');
    expect(defaultPlannedEnd({ normDays: null, dueDate: '2026-08-30' }, TODAY))
      .toBe('2026-08-30');
  });

  /**
   * «Сегодня» здесь стоять не должно, пока есть срок заказа: этап с дальним
   * сроком становился бы «просрочен» на следующий день — дефект ERP-04.
   */
  it('без норматива берёт срок заказа, а не сегодня', () => {
    expect(defaultPlannedEnd({ dueDate: '2026-09-15' }, TODAY)).toBe('2026-09-15');
  });

  it('когда нет ничего — сегодня: поле обязательно, пустым его не оставить', () => {
    expect(defaultPlannedEnd({}, TODAY)).toBe(TODAY);
    expect(defaultPlannedEnd({ plannedEnd: null, normDays: null, dueDate: null }, TODAY))
      .toBe(TODAY);
  });

  it('норматив отсчитывается от переданного дня, а не от системного', () => {
    // Аргумент обязан влиять на ВСЕ ступени: иначе тест проверяет одно,
    // а в цеху работает другое
    expect(defaultPlannedEnd({ normDays: 2 }, '2026-12-30')).toBe('2027-01-01');
  });

  /**
   * ДАТА ЗАПУСКА УЧАСТВУЕТ В РАСЧЁТЕ (правка 30.08, п. 10). До правки она
   * не входила НИ В ОДНУ формулу — её только показывали, — и заказ, который
   * запустят на следующей неделе, получал план от «сегодня»: обещание
   * на срок, к которому цех даже не приступит.
   */
  describe('дата запуска', () => {
    it('запуск в будущем сдвигает базу норматива на себя', () => {
      expect(defaultPlannedEnd({ normDays: 3, launchDate: '2026-09-01' }, TODAY))
        .toBe('2026-09-04');
    });

    it('без норматива и срока план не раньше запуска', () => {
      expect(defaultPlannedEnd({ launchDate: '2026-09-01' }, TODAY)).toBe('2026-09-01');
    });

    /**
     * Запуск в ПРОШЛОМ — тот самый случай, ради которого п. 10 и написан, —
     * базу не двигает: этап берут в работу сегодня, и план в прошлом объявил бы
     * просроченным то, что только начинается. Прошлое запуска отвечает
     * на другой вопрос и видно в производственном плане.
     */
    it('запуск в прошлом базу не двигает — план не уезжает во вчера', () => {
      expect(defaultPlannedEnd({ normDays: 2, launchDate: '2026-08-01' }, TODAY))
        .toBe('2026-08-26');
      expect(defaultPlannedEnd({ launchDate: '2026-08-01' }, TODAY)).toBe(TODAY);
    });

    it('свой план этапа по-прежнему сильнее запуска', () => {
      expect(defaultPlannedEnd({
        plannedEnd: '2026-08-25', launchDate: '2026-09-01',
      }, TODAY)).toBe('2026-08-25');
    });

    it('срок заказа сильнее базы — правило ERP-04 не отменялось', () => {
      expect(defaultPlannedEnd({ dueDate: '2026-09-15', launchDate: '2026-09-01' }, TODAY))
        .toBe('2026-09-15');
    });
  });
});

describe('unplannedStages', () => {
  const st = (status: string, planned: string | null = null) =>
    ({ status, planned_end: planned });

  it('считает только открытые этапы', () => {
    expect(unplannedStages([
      st('waiting'), st('in_progress'), st('done'), st('skipped'),
    ])).toEqual({ total: 2, unplanned: 2 });
  });

  it('этап с датой в недостающие не идёт', () => {
    expect(unplannedStages([st('waiting', '2026-09-01'), st('ready')]))
      .toEqual({ total: 2, unplanned: 1 });
  });

  it('закрытый этап без даты ничего не значит — план ему уже не нужен', () => {
    expect(unplannedStages([st('done'), st('skipped')]))
      .toEqual({ total: 0, unplanned: 0 });
  });

  it('пустой и отсутствующий набор не роняют расчёт', () => {
    expect(unplannedStages([])).toEqual({ total: 0, unplanned: 0 });
    expect(unplannedStages(null)).toEqual({ total: 0, unplanned: 0 });
  });
});
