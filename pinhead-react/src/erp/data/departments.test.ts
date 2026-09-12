import { describe, it, expect } from 'vitest';
import {
  DEPARTMENTS,
  DEPT_ICONS,
  DEPT_SHORT_NAMES,
  QUEUE_DEPT_CODES,
  deptShortName,
  getDepartmentByCode,
} from './departments';

describe('DEPARTMENTS seed', () => {
  it('содержит 13 участков', () => {
    // Было 14: участок DTG снят правками 07.09 (п. 17)
    expect(DEPARTMENTS).toHaveLength(13);
  });

  /**
   * «Подряд» заведён участком правками 21.08 — это точка ввода подрядного этапа
   * в конструкторе маршрута. В общую очередь он не входит: документ просит,
   * чтобы задача была видна только во вкладке «Подряд».
   */
  it('«Подряд» — участок, но не цех с очередью', () => {
    expect(getDepartmentByCode('outsource')?.name).toBe('Подряд');
    expect(QUEUE_DEPT_CODES.has('outsource')).toBe(false);
  });

  /**
   * СТОРОЖ ПРОВЕРЯЕТ СВОЮ ПРИЧИНУ, А НЕ СПОСОБ (правка 12.09, п. 6).
   *
   * Прежняя редакция требовала ключ в `DEPT_SHORT_NAMES` у КАЖДОГО участка,
   * объясняя это тем, что иначе «чип покажет код вместо названия». Причина
   * верная, требование — сильнее неё: имя приходит фолбэком из данных
   * (`deptShortName(code, name)`), и участку, чьё полное имя помещается,
   * короткое не нужно вовсе. По прежнему сторожу снятие «Швейки» выглядело бы
   * поломкой, хотя это и есть починка.
   */
  it('название участка не подменяется кодом', () => {
    for (const d of DEPARTMENTS) {
      const shown = deptShortName(d.code, d.name);
      expect(shown, `участок показан кодом: ${d.code}`).not.toBe(d.code);
      expect(shown, `нет названия: ${d.code}`).toBeTruthy();
      expect(DEPT_ICONS[d.code], `нет иконки: ${d.code}`).toBeTruthy();
    }
  });

  /**
   * РЕШЕНИЕ ЗАКАЗЧИКА ЗАКРЕПЛЕНО ПОИМЁННО (правка 12.09, п. 6): «переименовать
   * участок „Швейка" в „Швейный цех" во всём интерфейсе ERP».
   *
   * Сторож смотрит на то, что увидит человек, а не на отсутствие ключа: вернуть
   * «Швейку» можно и через фолбэк, и через сид. В базе участок назван «Швейный
   * цех» с первой миграции — короткого имени ему не нужно вовсе.
   */
  it('«Швейка» не печатается — участок называется «Швейный цех»', () => {
    const sewing = getDepartmentByCode('sewing');
    expect(sewing?.name).toBe('Швейный цех');
    expect(deptShortName('sewing', sewing?.name)).toBe('Швейный цех');
    expect(DEPT_SHORT_NAMES.sewing).toBeUndefined();
  });

  it('ОТК заведён производственным участком с очередью', () => {
    expect(getDepartmentByCode('qc')?.name).toBe('ОТК');
    expect(QUEUE_DEPT_CODES.has('qc')).toBe(true);
  });

  it('коды уникальны', () => {
    const codes = DEPARTMENTS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('отмечает три цеха брендирования', () => {
    // Четвёртым был DTG — участок снят правками 07.09 (п. 17); сам метод
    // нанесения остался читаемым, см. `utils/brandingMethods.test.ts`
    const branding = DEPARTMENTS.filter((d) => d.is_branding).map((d) => d.code);
    expect(branding).toEqual(['silkscreen', 'dtf', 'embroidery']);
  });

  it('getDepartmentByCode находит по коду', () => {
    expect(getDepartmentByCode('sewing')?.name).toBe('Швейный цех');
    expect(getDepartmentByCode('missing')).toBeUndefined();
  });
});
