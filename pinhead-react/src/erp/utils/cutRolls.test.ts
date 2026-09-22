import { describe, it, expect } from 'vitest';
import type { ErpMaterial, ErpMaterialRoll, SizeGridRow } from '../types';
import {
  rollsForItem, rollLabel, cutTotals, rollTotal, cutBlock, rollLeft,
  cutSizesPayload, cutRollsPayload, sizeCellsOf, cellKey,
} from './cutRolls';
import type { CutSizeRow } from './cutRolls';

const roll = (n: number, extra: Partial<ErpMaterialRoll> = {}): ErpMaterialRoll => ({
  id: `r${n}`, material_id: 'm1', receipt_id: null, seq: n, label: `Рулон №${n}`,
  qty: null, unit: 'кг', status: 'in_stock', created_at: '2026-09-16', ...extra,
} as ErpMaterialRoll);

const fabric = (extra: Partial<ErpMaterial> = {}): ErpMaterial => ({
  id: 'm1', order_id: 'o1', item_id: 'i1', kind: 'fabric', name: 'Футер 3-нитка',
  source: 'purchase', supplier: null, role: null, color: 'чёрный', article: '1234',
  qty: null, status: 'received', eta_date: null, received_at: null, notes: null,
  qty_expected: 100, qty_received: 100, accept_status: 'accepted_full',
  accepted_at: null, accepted_by: null, accept_comment: null,
  fact_name: null, fact_color: null, fact_article: null,
  created_at: '', updated_at: '', rolls: [roll(1), roll(2)], ...extra,
} as ErpMaterial);

const GRID: SizeGridRow[] = [{ color: '—', sizes: { XS: 4, S: 8, M: 10, L: 8, XL: 6 } }];
const CELLS = sizeCellsOf(GRID);
const key = (size: string) => cellKey({ color: '—', size });

/**
 * Размерные строки рулона (правка 20.09, п. 7). До неё это был объект
 * «ключ → количество»; теперь закройщик добавляет и удаляет СТРОКИ,
 * и у строки бывает состояние «размер ещё не выбран».
 */
const rows = (...pairs: [string, number][]): CutSizeRow[] => pairs
  .map(([size, qty]) => ({ size, color: '—', qty }));

describe('rollsForItem — рулоны не вводятся вручную', () => {
  it('предлагает рулоны тканей ЭТОЙ позиции', () => {
    expect(rollsForItem([fabric()], 'i1').map((o) => o.roll.label))
      .toEqual(['Рулон №1', 'Рулон №2']);
  });

  it('материал чужой позиции не предлагается', () => {
    expect(rollsForItem([fabric({ item_id: 'i2' })], 'i1')).toEqual([]);
  });

  /**
   * Приёмка обязана вынести вердикт: рулон существует физически только после
   * того, как склад его принял. Иначе закрой отчитался бы по ткани, которой
   * на фабрике нет.
   */
  it.each([[null], ['shortage'], ['rejected'], ['mismatch']])(
    'вердикт приёмки «%s» рулоны не выдаёт', (accept) => {
      expect(rollsForItem([fabric({ accept_status: accept as never })], 'i1')).toEqual([]);
    },
  );

  it('частичная приёмка рулоны выдаёт — они уже на фабрике', () => {
    expect(rollsForItem([fabric({ accept_status: 'accepted_partial' })], 'i1')).toHaveLength(2);
  });

  it('фурнитура рулонов не даёт — кроят из ткани', () => {
    expect(rollsForItem([fabric({ kind: 'hardware' })], 'i1')).toEqual([]);
  });

  it('израсходованный рулон не предлагается заново', () => {
    const m = fabric({ rolls: [roll(1, { status: 'used' }), roll(2)] });
    expect(rollsForItem([m], 'i1').map((o) => o.roll.label)).toEqual(['Рулон №2']);
  });

  /**
   * …но уже выбранный в текущей форме остаётся видимым, иначе строка исчезла
   * бы прямо во время заполнения.
   */
  it('выбранный израсходованный рулон из списка не пропадает', () => {
    const m = fabric({ rolls: [roll(1, { status: 'used' }), roll(2)] });
    expect(rollsForItem([m], 'i1', ['r1']).map((o) => o.roll.label))
      .toEqual(['Рулон №1', 'Рулон №2']);
  });

  it('рулоны идут по номерам, а не по порядку хранения', () => {
    const m = fabric({ rolls: [roll(3), roll(1), roll(2)] });
    expect(rollsForItem([m], 'i1').map((o) => o.roll.seq)).toEqual([1, 2, 3]);
  });

  it('подпись называет рулон и по какому материалу он пришёл', () => {
    expect(rollLabel(roll(3), fabric())).toBe('Рулон №3 · Футер 3-нитка · чёрный · арт. 1234');
  });

  it('подпись берёт ФАКТИЧЕСКИЕ атрибуты, когда склад отметил пересорт', () => {
    const m = fabric({ fact_name: 'Футер 2-нитка', fact_color: 'синий', fact_article: '9' });
    expect(rollLabel(roll(1), m)).toBe('Рулон №1 · Футер 2-нитка · синий · арт. 9');
  });
});

describe('автоматические итоги', () => {
  const entries = [
    { rollId: 'r1', qtyUsed: 19.4, sizes: rows(['XS', 4], ['S', 8], ['M', 10]) },
    { rollId: 'r2', qtyUsed: 19.4, sizes: rows(['L', 8], ['XL', 6], ['M', 2]) },
  ];

  it('итог с одного рулона — сумма его размеров', () => {
    expect(rollTotal(entries[0])).toBe(22);
  });

  it('общий итог складывает рулоны и размеры', () => {
    const totals = cutTotals(entries);
    expect(totals.qty).toBe(38);
    expect(totals.rolls).toBe(2);
    expect(totals.bySize[key('M')]).toBe(12);
  });

  /**
   * Расход — дробное число (метры, килограммы). Без округления 19.4 + 19.4
   * даёт 38.800000000000004 прямо в подписи цеху.
   */
  it('расход ткани складывается без хвоста двоичной дроби', () => {
    expect(cutTotals(entries).used).toBe(38.8);
  });

  it('пустые строки в итог не попадают', () => {
    expect(cutTotals([{ rollId: 'r1', qtyUsed: 0, sizes: [] }]).rolls).toBe(0);
    expect(cutTotals(null).qty).toBe(0);
  });
});

describe('cutBlock — почему нельзя сдать', () => {
  it('без рулонов сдавать нечего', () => {
    expect(cutBlock([])).toContain('Добавьте рулон');
  });

  it('рулон без расхода назван по имени', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock([{ rollId: 'r1', qtyUsed: 0, sizes: rows(['XS', 4]) }], options);
    expect(block).toContain('Рулон №1');
    expect(block).toContain('расход');
  });

  it('рулон без изделий назван по имени', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock([{ rollId: 'r2', qtyUsed: 19, sizes: [] }], options);
    expect(block).toContain('Рулон №2');
    expect(block).toContain('скроено');
  });

  it('один рулон дважды — это ошибка ввода, а не два рулона', () => {
    const options = rollsForItem([fabric()], 'i1');
    const twice = [
      { rollId: 'r1', qtyUsed: 10, sizes: rows(['XS', 2]) },
      { rollId: 'r1', qtyUsed: 10, sizes: rows(['S', 2]) },
    ];
    expect(cutBlock(twice, options)).toContain('дважды');
  });

  it('заполненная форма не блокируется', () => {
    const options = rollsForItem([fabric()], 'i1');
    expect(cutBlock([{ rollId: 'r1', qtyUsed: 19, sizes: rows(['XS', 4]) }], options)).toBeNull();
  });

  /**
   * Правка 20.09, п. 7: «Один и тот же размер внутри одного рулона не должен
   * добавляться дважды. Если размер уже выбран в этом рулоне, система должна
   * предложить изменить количество в существующей строке».
   */
  it('один размер дважды в одном рулоне — отказ с подсказкой, что делать', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock(
      [{ rollId: 'r1', qtyUsed: 19, sizes: rows(['M', 4], ['M', 6]) }],
      options,
    );
    expect(block).toContain('M');
    expect(block).toContain('дважды');
    expect(block).toContain('измените количество');
  });

  it('количество без выбранного размера — отдельная ошибка, а не «нечего сдавать»', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock(
      [{ rollId: 'r1', qtyUsed: 19, sizes: [{ size: '', color: '—', qty: 5 }] }],
      options,
    );
    expect(block).toContain('выберите размер');
  });

  it('пустая строка размера сдавать не мешает — её просто не сохраняют', () => {
    const options = rollsForItem([fabric()], 'i1');
    const entries = [{
      rollId: 'r1',
      qtyUsed: 19,
      sizes: [...rows(['M', 4]), { size: '', color: '—', qty: 0 }],
    }];
    expect(cutBlock(entries, options)).toBeNull();
    expect(cutRollsPayload(entries)[0].sizes).toEqual([{ color: '—', size: 'M', qty_good: 4 }]);
  });
});

describe('что уезжает в отчёт этапа', () => {
  const entries = [
    { rollId: 'r1', qtyUsed: 19.4, sizes: rows(['XS', 4], ['S', 8]) },
    { rollId: 'r2', qtyUsed: 12, sizes: rows(['S', 2]), finished: true },
  ];

  it('размеры — суммой по всем рулонам', () => {
    expect(cutSizesPayload(entries)).toEqual([
      { color: '—', size: 'XS', qty_good: 4 },
      { color: '—', size: 'S', qty_good: 10 },
    ]);
  });

  /**
   * ГЛАВНОЕ ПОСЛЕДСТВИЕ ПРАВКИ 20.09 (п. 7). Прежняя версия собирала разбивку
   * ПО ЯЧЕЙКАМ СЕТКИ ПОЗИЦИИ: нет сетки — нет ячеек — пустой список, и
   * размерный факт закроя не сохранялся вовсе. На бою так заведена 21 позиция
   * из 49, и именно на такой заказчик проверял правку.
   */
  it('позиция без размерной сетки: разбивка всё равно уезжает в отчёт', () => {
    const free = [{ rollId: 'r1', qtyUsed: 10, sizes: rows(['M', 3], ['L', 2]) }];
    expect(cutSizesPayload(free)).toEqual([
      { color: '—', size: 'M', qty_good: 3 },
      { color: '—', size: 'L', qty_good: 2 },
    ]);
  });

  it('строки рулонов несут расход, материал и признак «израсходован»', () => {
    const options = rollsForItem([fabric()], 'i1');
    const payload = cutRollsPayload(entries, options);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ roll_id: 'r1', material_id: 'm1', qty_used: 19.4, finished: false });
    expect(payload[1]).toMatchObject({ roll_id: 'r2', finished: true });
    expect(payload[1].sizes).toEqual([{ color: '—', size: 'S', qty_good: 2 }]);
  });

  it('пустая строка рулона в отчёт не уезжает', () => {
    expect(cutRollsPayload([{ rollId: 'r1', qtyUsed: 5, sizes: [] }])).toEqual([]);
  });
});

/**
 * ОСТАТОК РУЛОНА (правка заказчика 21.09, п. 5).
 *
 * «Система автоматически считает остаток рулона: первоначальный вес минус
 * фактический расход… Фактический расход не может быть больше принятого веса
 * рулона» (п. 2).
 */
describe('rollLeft — остаток рулона', () => {
  it('первоначальный вес минус расход', () => {
    expect(rollLeft(roll(1, { qty: 20 }), 10)).toBe(10);
    expect(rollLeft(roll(1, { qty: 20 }), 20)).toBe(0);
  });

  it('уже израсходованное учитывается: считаем от остатка, а не от веса', () => {
    // С рулона кроят в несколько заходов: осталось 12, списываем ещё 5
    expect(rollLeft(roll(1, { qty: 20, qty_left: 12 }), 5)).toBe(7);
  });

  it('дробные килограммы не дают хвоста с плавающей точкой', () => {
    expect(rollLeft(roll(1, { qty: 20 }), 19.4)).toBe(0.6);
  });

  /**
   * FAIL-OPEN: сорок один рулон на бою принят до правки, веса у них нет.
   * Прочерк честнее выдуманного числа — «0» читалось бы как «ткань кончилась».
   */
  it('без веса рулона остаток неизвестен, а не ноль', () => {
    expect(rollLeft(roll(1), 10)).toBeNull();
    expect(rollLeft(null, 10)).toBeNull();
  });

  it('перерасход не уводит остаток в минус', () => {
    expect(rollLeft(roll(1, { qty: 20 }), 25)).toBe(0);
  });
});

describe('cutBlock — остаток и потолок расхода', () => {
  const options = [{
    roll: roll(1, { qty: 20 }),
    material: fabric(),
    label: 'Рулон №1',
  }];
  const entry = (extra = {}) => ({
    rollId: 'r1',
    qtyUsed: 10,
    sizes: [{ size: 'M', color: '—', qty: 5 }] as CutSizeRow[],
    ...extra,
  });

  it('расход больше веса рулона — сдать нельзя, числа названы', () => {
    const msg = cutBlock([entry({ qtyUsed: 25 })], options);
    expect(msg).toContain('в рулоне 20');
    expect(msg).toContain('25');
  });

  it('расход в пределах веса проходит', () => {
    expect(cutBlock([entry()], options)).toBeNull();
  });

  /** У рулона без веса потолка нет: цех не должен вставать из-за пустого поля */
  it('у рулона без веса перерасход не ловится — цех не встаёт', () => {
    const noWeight = [{ roll: roll(1), material: fabric(), label: 'Рулон №1' }];
    expect(cutBlock([entry({ qtyUsed: 999 })], noWeight)).toBeNull();
  });

  /**
   * Без вида остатка килограммы повисают: в экономику заказа не попадают
   * (там считается только «пригоден») и на складе не появляются.
   */
  it('работа закончена, остаток есть, вид не выбран — сдать нельзя', () => {
    const msg = cutBlock([entry({ finished: true })], options);
    expect(msg).toContain('остался 10');
  });

  it('вид остатка выбран — можно сдавать', () => {
    expect(cutBlock([entry({ finished: true, leftover: 'scrap' })], options)).toBeNull();
  });

  it('рулон израсходован под ноль — вида остатка не спрашиваем', () => {
    expect(cutBlock([entry({ qtyUsed: 20, finished: true })], options)).toBeNull();
  });

  it('вид остатка уезжает в payload только при законченной работе', () => {
    const done = cutRollsPayload([entry({ finished: true, leftover: 'usable' })], options);
    expect(done[0]).toMatchObject({ finished: true, leftover: 'usable' });
    // Работа не закончена — остаток промежуточный, объявлять его рано
    const going = cutRollsPayload([entry({ finished: false, leftover: 'usable' })], options);
    expect(going[0]).toMatchObject({ finished: false, leftover: null });
  });
});
