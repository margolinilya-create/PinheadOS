import { afterEach, describe, expect, it } from 'vitest';
import { myDeptCode } from './myDept';

const DEPTS = [
  { id: 'd-cut', code: 'cutting' },
  { id: 'd-sew', code: 'sewing' },
];

afterEach(() => localStorage.clear());

describe('свой участок', () => {
  it('берёт код по привязке сотрудника', () => {
    expect(myDeptCode(DEPTS, 'd-sew')).toBe('sewing');
  });

  it('привязка сильнее последнего выбранного', () => {
    // Иначе рабочий, заглянувший вчера в чужую очередь, приземлялся бы туда же
    localStorage.setItem('erp_my_dept', 'cutting');
    expect(myDeptCode(DEPTS, 'd-sew')).toBe('sewing');
  });

  it('без привязки отдаёт последний выбранный участок', () => {
    localStorage.setItem('erp_my_dept', 'cutting');
    expect(myDeptCode(DEPTS, null)).toBe('cutting');
  });

  it('привязка на неизвестный участок откатывается на выбранный', () => {
    // Цех деактивирован или ещё не приехал в справочник — это не повод
    // отвечать «своего участка нет», пока последний выбранный известен
    localStorage.setItem('erp_my_dept', 'cutting');
    expect(myDeptCode(DEPTS, 'd-gone')).toBe('cutting');
  });

  it('нет ни того ни другого — ПУСТАЯ СТРОКА, а не null', () => {
    // Вызывающие подставляют результат в адрес: `null` дал бы `/queue/null`,
    // то есть страницу несуществующего цеха вместо отказа
    expect(myDeptCode(DEPTS, null)).toBe('');
    expect(myDeptCode(undefined, null)).toBe('');
  });
});
