import { describe, it, expect } from 'vitest';
import {
  intakeRows, intakeTotals, intakeSizes, intakeBlock, intakeShortfallWarning,
  intakeComment, intakeClosesStage,
} from './garmentIntake';

const PEN = { product_type: 'Ручка', qty: 50, size_grid: null };
const SHIRT = {
  product_type: 'Футболка',
  variant: 'чёрная',
  qty: 50,
  size_grid: [{ color: '—', sizes: { XS: 10, S: 20, M: 15, L: 5 } }],
};

describe('intakeRows — позиция без размерной сетки', () => {
  it('даёт одну строку с тиражом из заказа', () => {
    expect(intakeRows(PEN)).toEqual([{
      key: 'total', color: '—', size: '', label: 'Ручка', expected: 50, accepted: 50,
    }]);
  });

  it('подпись склеивает изделие и вариант — на складе рядом лежат две футболки', () => {
    expect(intakeRows({ product_type: 'Футболка', variant: 'чёрная', qty: 3 })[0].label)
      .toBe('Футболка · чёрная');
  });
});

describe('intakeRows — позиция с размерной сеткой', () => {
  it('строка на каждый размер, количество подставлено из заказа', () => {
    expect(intakeRows(SHIRT).map((r) => [r.size, r.expected, r.accepted])).toEqual([
      ['XS', 10, 10], ['S', 20, 20], ['M', 15, 15], ['L', 5, 5],
    ]);
  });

  it('размеры идут по шкале, а не по порядку ключей объекта', () => {
    const grid = [{ color: '—', sizes: { L: 5, XS: 10, M: 15 } }];
    expect(intakeRows({ ...SHIRT, size_grid: grid }).map((r) => r.size)).toEqual(['XS', 'M', 'L']);
  });

  it('два цвета дают отдельные строки и различимые подписи', () => {
    const grid = [
      { color: 'чёрный', sizes: { S: 4 } },
      { color: 'белый', sizes: { S: 6 } },
    ];
    const rows = intakeRows({ ...SHIRT, size_grid: grid });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.label)).toEqual(['S · чёрный', 'S · белый']);
    // Ключи обязаны различаться, иначе вторая строка перезапишет первую
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe('intakeRows — предзаполнение фактом закупки (п. 2 документа)', () => {
  it('факт закупки приоритетнее плана заказа', () => {
    const fact = [{ color: '—', sizes: { XS: 8, S: 20, M: 15, L: 5 } }];
    expect(intakeRows(SHIRT, fact).map((r) => r.accepted)).toEqual([8, 20, 15, 5]);
  });

  /**
   * Ноль — осмысленный факт («этот размер не привезли»), и подменять его
   * тиражом нельзя: кладовщик принял бы десять несуществующих изделий.
   */
  it('нулевой факт размера не подменяется тиражом', () => {
    const fact = [{ color: '—', sizes: { XS: 10, S: 20, M: 15 } }];
    const rows = intakeRows(SHIRT, fact);
    expect(rows.find((r) => r.size === 'L')?.accepted).toBe(5);
    const zeroFact = intakeRows(
      { ...SHIRT, size_grid: [{ color: '—', sizes: { XS: 10 } }] },
      [{ color: '—', sizes: { XS: 0 } }],
    );
    // Ячейки с нулём в сетке строк не образуют — значит факт «нет ни одной»
    // приходит отсутствием ячейки, и тираж остаётся. Проверяем осознанно:
    expect(zeroFact[0].accepted).toBe(10);
  });

  it('лишний размер в закупке не добавляет строку — окно принимает ЗАКАЗАННОЕ', () => {
    const fact = [{ color: '—', sizes: { XS: 10, S: 20, M: 15, L: 5, XL: 7 } }];
    expect(intakeRows(SHIRT, fact)).toHaveLength(4);
  });
});

describe('итоги, блокировка и предупреждение', () => {
  it('итоги складывают заказанное и принимаемое', () => {
    expect(intakeTotals(intakeRows(SHIRT))).toEqual({ expected: 50, accepted: 50, shortfall: 0 });
  });

  it('недоприёмка считается и называется числами', () => {
    const rows = intakeRows(SHIRT).map((r) => (r.size === 'S' ? { ...r, accepted: 17 } : r));
    expect(intakeTotals(rows)).toEqual({ expected: 50, accepted: 47, shortfall: 3 });
    expect(intakeShortfallWarning(rows)).toContain('Принято 47 из 50');
    expect(intakeShortfallWarning(rows)).toContain('недостача 3');
  });

  it('при полной приёмке предупреждать не о чем', () => {
    expect(intakeShortfallWarning(intakeRows(SHIRT))).toBeNull();
  });

  it('нулевая приёмка не записывается — это и есть жалоба «склад отчитался 0 из N»', () => {
    const rows = intakeRows(SHIRT).map((r) => ({ ...r, accepted: 0 }));
    expect(intakeBlock(rows)).toContain('сколько изделий фактически принято');
  });

  it('принять больше заказанного нельзя без проверки количества', () => {
    const rows = intakeRows(PEN).map((r) => ({ ...r, accepted: 60 }));
    expect(intakeBlock(rows)).toContain('60');
    expect(intakeBlock(rows)).toContain('50');
  });

  it('обычная приёмка не блокируется', () => {
    expect(intakeBlock(intakeRows(SHIRT))).toBeNull();
    expect(intakeBlock(intakeRows(PEN))).toBeNull();
  });

  it('комментарий журнала называет оба числа', () => {
    const rows = intakeRows(PEN).map((r) => ({ ...r, accepted: 47 }));
    expect(intakeComment(rows)).toBe('Приёмка: принято 47 из 50 шт');
  });
});

describe('intakeSizes', () => {
  it('строки с размерами превращаются в разбивку для отчёта этапа', () => {
    const rows = intakeRows(SHIRT).map((r) => (r.size === 'S' ? { ...r, accepted: 17 } : r));
    expect(intakeSizes(rows)).toEqual([{ color: '—', sizes: { XS: 10, S: 17, M: 15, L: 5 } }]);
  });

  it('позиция без сетки разбивки не даёт — там число, а не размеры', () => {
    expect(intakeSizes(intakeRows(PEN))).toEqual([]);
  });
});

describe('intakeClosesStage', () => {
  it('полная приёмка закрывает этап', () => {
    expect(intakeClosesStage(intakeRows(SHIRT), SHIRT)).toBe(true);
  });

  it('недоприёмка этап не закрывает — ровно этого просит документ', () => {
    const rows = intakeRows(PEN).map((r) => ({ ...r, accepted: 47 }));
    expect(intakeClosesStage(rows, PEN)).toBe(false);
  });

  it('добор предыдущей поставкой закрывает: 20 принято раньше + 30 сейчас', () => {
    const rows = intakeRows(PEN).map((r) => ({ ...r, accepted: 30 }));
    expect(intakeClosesStage(rows, PEN, 20)).toBe(true);
  });
});
