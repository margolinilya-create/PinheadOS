import { describe, it, expect } from 'vitest';
import type { ErpMaterial, ErpMaterialRoll, SizeGridRow } from '../types';
import {
  rollsAwaitingFate, rollsFateBlock,
  rollsForItem, rollLabel, cutTotals, rollTotal, cutBlock, rollLeft,
  cutSizesPayload, cutRollsPayload, sizeCellsOf, cellKey,
} from './cutRolls';
import type { CutSizeRow } from './cutRolls';

/**
 * Рулон по умолчанию — С МЕТРАЖОМ (правка 27.09, п. 4: без него расход
 * не записывается): 20 кг × 180 см × 240 г/м² → 46,30 м, 0,432 кг/м.
 * `bare` — рулон, принятый до учёта в метрах: вес и параметры пусты.
 */
const roll = (n: number, extra: Partial<ErpMaterialRoll> = {}): ErpMaterialRoll => ({
  id: `r${n}`, material_id: 'm1', receipt_id: null, seq: n, label: `Рулон №${n}`,
  qty: 20, unit: 'кг', status: 'in_stock', created_at: '2026-09-16',
  width_cm: 180, density_gsm: 240, length_m: 46.2963, length_source: 'calc',
  length_left_m: null, kg_per_m: 0.432, price_per_m: null, ...extra,
} as ErpMaterialRoll);
const bare = (n: number, extra: Partial<ErpMaterialRoll> = {}): ErpMaterialRoll => roll(n, {
  qty: null, width_cm: null, density_gsm: null, length_m: null, length_source: null,
  kg_per_m: null, ...extra,
});

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
    { rollId: 'r1', lengthUsedM: 19.4, sizes: rows(['XS', 4], ['S', 8], ['M', 10]) },
    { rollId: 'r2', lengthUsedM: 19.4, sizes: rows(['L', 8], ['XL', 6], ['M', 2]) },
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
    expect(cutTotals([{ rollId: 'r1', lengthUsedM: 0, sizes: [] }]).rolls).toBe(0);
    expect(cutTotals(null).qty).toBe(0);
  });
});

describe('cutBlock — почему нельзя сдать', () => {
  it('без рулонов сдавать нечего', () => {
    expect(cutBlock([])).toContain('Добавьте рулон');
  });

  it('рулон без расхода назван по имени', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock([{ rollId: 'r1', lengthUsedM: 0, sizes: rows(['XS', 4]) }], options);
    expect(block).toContain('Рулон №1');
    expect(block).toContain('расход');
  });

  it('рулон без изделий назван по имени', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock([{ rollId: 'r2', lengthUsedM: 19, sizes: [] }], options);
    expect(block).toContain('Рулон №2');
    expect(block).toContain('скроено');
  });

  it('один рулон дважды — это ошибка ввода, а не два рулона', () => {
    const options = rollsForItem([fabric()], 'i1');
    const twice = [
      { rollId: 'r1', lengthUsedM: 10, sizes: rows(['XS', 2]) },
      { rollId: 'r1', lengthUsedM: 10, sizes: rows(['S', 2]) },
    ];
    expect(cutBlock(twice, options)).toContain('дважды');
  });

  it('заполненная форма не блокируется', () => {
    const options = rollsForItem([fabric()], 'i1');
    expect(cutBlock([{ rollId: 'r1', lengthUsedM: 19, sizes: rows(['XS', 4]) }], options)).toBeNull();
  });

  /**
   * Правка 20.09, п. 7: «Один и тот же размер внутри одного рулона не должен
   * добавляться дважды. Если размер уже выбран в этом рулоне, система должна
   * предложить изменить количество в существующей строке».
   */
  it('один размер дважды в одном рулоне — отказ с подсказкой, что делать', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock(
      [{ rollId: 'r1', lengthUsedM: 19, sizes: rows(['M', 4], ['M', 6]) }],
      options,
    );
    expect(block).toContain('M');
    expect(block).toContain('дважды');
    expect(block).toContain('измените количество');
  });

  it('количество без выбранного размера — отдельная ошибка, а не «нечего сдавать»', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock(
      [{ rollId: 'r1', lengthUsedM: 19, sizes: [{ size: '', color: '—', qty: 5 }] }],
      options,
    );
    expect(block).toContain('выберите размер');
  });

  it('пустая строка размера сдавать не мешает — её просто не сохраняют', () => {
    const options = rollsForItem([fabric()], 'i1');
    const entries = [{
      rollId: 'r1',
      lengthUsedM: 19,
      sizes: [...rows(['M', 4]), { size: '', color: '—', qty: 0 }],
    }];
    expect(cutBlock(entries, options)).toBeNull();
    expect(cutRollsPayload(entries)[0].sizes).toEqual([{ color: '—', size: 'M', qty_good: 4 }]);
  });
});

describe('что уезжает в отчёт этапа', () => {
  const entries = [
    { rollId: 'r1', lengthUsedM: 19.4, sizes: rows(['XS', 4], ['S', 8]) },
    { rollId: 'r2', lengthUsedM: 12, sizes: rows(['S', 2]), finished: true },
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
    const free = [{ rollId: 'r1', lengthUsedM: 10, sizes: rows(['M', 3], ['L', 2]) }];
    expect(cutSizesPayload(free)).toEqual([
      { color: '—', size: 'M', qty_good: 3 },
      { color: '—', size: 'L', qty_good: 2 },
    ]);
  });

  it('строки рулонов несут расход, материал и признак «израсходован»', () => {
    const options = rollsForItem([fabric()], 'i1');
    const payload = cutRollsPayload(entries, options);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ roll_id: 'r1', material_id: 'm1', length_used_m: 19.4, finished: false });
    expect(payload[1]).toMatchObject({ roll_id: 'r2', finished: true });
    expect(payload[1].sizes).toEqual([{ color: '—', size: 'S', qty_good: 2 }]);
  });

  it('пустая строка рулона в отчёт не уезжает', () => {
    expect(cutRollsPayload([{ rollId: 'r1', lengthUsedM: 5, sizes: [] }])).toEqual([]);
  });
});

/**
 * ОСТАТОК РУЛОНА (правка заказчика 21.09, п. 5).
 *
 * «Система автоматически считает остаток рулона: первоначальный вес минус
 * фактический расход… Фактический расход не может быть больше принятого веса
 * рулона» (п. 2).
 */
const metred = roll;
const opt = (r: ErpMaterialRoll) => ({ roll: r, material: fabric(), label: r.label });

describe('rollLeft — остаток рулона в метрах (27.09, п. 4)', () => {
  it('доступный метраж минус расход', () => {
    expect(rollLeft(opt(metred(1)), 10)).toBe(36.3);
    expect(rollLeft(opt(metred(1, { length_m: 20 })), 20)).toBe(0);
  });

  it('уже израсходованное учтено: считаем от остатка сервера, а не от полного метража', () => {
    // С рулона кроят в несколько заходов: осталось 12, списываем ещё 5
    expect(rollLeft(opt(metred(1, { length_left_m: 12 })), 5)).toBe(7);
  });

  it('сотые метра не дают хвоста с плавающей точкой', () => {
    expect(rollLeft(opt(metred(1, { length_m: 20 })), 19.4)).toBe(0.6);
  });

  /**
   * Рулон без хранимого метража, но с параметрами материала — остаток
   * считается по расчёту (закройщик видит число), а без параметров —
   * прочерк: выдуманного числа тут быть не должно.
   */
  it('без хранимого метража считает по параметрам, без параметров — null', () => {
    const noStored = { roll: bare(1, { qty: 20 }), material: fabric({ width_cm: 180, density_gsm: 240 }), label: '' };
    expect(rollLeft(noStored, 10)).toBeCloseTo(36.3, 2);
    expect(rollLeft(opt(bare(1)), 10)).toBeNull();
    expect(rollLeft(null, 10)).toBeNull();
  });

  it('перерасход не уводит остаток в минус', () => {
    expect(rollLeft(opt(metred(1, { length_m: 20 })), 25)).toBe(0);
  });
});

describe('cutBlock — метраж, потолок и судьба остатка', () => {
  const options = [opt(metred(1, { length_m: 20 }))];
  const entry = (extra = {}) => ({
    rollId: 'r1',
    lengthUsedM: 10,
    sizes: [{ size: 'M', color: '—', qty: 5 }] as CutSizeRow[],
    ...extra,
  });

  it('расход больше доступного — сдать нельзя, числа названы словами сервера', () => {
    const msg = cutBlock([entry({ lengthUsedM: 25 })], options);
    expect(msg).toBe('Рулон №1: доступно 20,00 м, а списывается 25,00 м — уточните метраж рулона или уменьшите расход');
  });

  it('расход в пределах метража проходит', () => {
    expect(cutBlock([entry()], options)).toBeNull();
  });

  /**
   * БЕЗ РАБОЧЕГО МЕТРАЖА РАСХОД НЕ ЗАПИСЫВАЕТСЯ — это НЕ fail-open, как было
   * у веса: документ требует «не давать записать расход в метрах», а
   * параметры закрой дозаполняет прямо в форме.
   */
  it('у рулона без метража — отказ «Не заполнены данные для учёта в метрах»', () => {
    const noMetres = [opt(bare(1))];
    expect(cutBlock([entry()], noMetres)).toContain('Не заполнены данные для учёта в метрах');
  });

  it('работа закончена, остаток есть, вид не выбран — сдать нельзя, остаток в метрах', () => {
    const msg = cutBlock([entry({ finished: true })], options);
    expect(msg).toBe('Рулон №1: остался 10,00 м — выберите «Остаток пригоден» или «Малый остаток, не учитывать»');
  });

  it('измеренный остаток главнее расчётного — и при нуле вида не спрашиваем', () => {
    expect(cutBlock([entry({ finished: true, leftoverMeasuredM: 0 })], options)).toBeNull();
    expect(cutBlock([entry({ finished: true, leftoverMeasuredM: '2.5' })], options))
      .toContain('остался 2,50 м');
    expect(cutBlock([entry({ finished: true, leftoverMeasuredM: -1 })], options))
      .toContain('не может быть отрицательным');
  });

  it('вид остатка выбран — можно сдавать', () => {
    expect(cutBlock([entry({ finished: true, leftover: 'scrap' })], options)).toBeNull();
  });

  it('рулон израсходован под ноль — вида остатка не спрашиваем', () => {
    expect(cutBlock([entry({ lengthUsedM: 20, finished: true })], options)).toBeNull();
  });

  it('вид остатка и замер уезжают в payload только при законченной работе', () => {
    const done = cutRollsPayload([entry({ finished: true, leftover: 'usable', leftoverMeasuredM: '9.5' })], options);
    expect(done[0]).toMatchObject({ finished: true, leftover: 'usable', leftover_measured_m: 9.5, length_used_m: 10 });
    // Работа не закончена — остаток промежуточный, объявлять его рано
    const going = cutRollsPayload([entry({ finished: false, leftover: 'usable', leftoverMeasuredM: '9.5' })], options);
    expect(going[0]).toMatchObject({ finished: false, leftover: null, leftover_measured_m: null });
  });
});

/**
 * СУДЬБА ОСТАТКА ОБЯЗАТЕЛЬНА ПРИ ЗАКРЫТИИ ЗАКРОЯ (правка заказчика 27.09, п. 2).
 *
 * «Сейчас этап закройки можно завершить при наличии остатка по рулону без
 * указания его пригодности. Из-за этого пригодный остаток не попадает
 * в раздел „Остатки ткани"». На бою 27.09 вид не выбран ни у одного из 60
 * рулонов. Рулон, оставленный «в работе» без галочки, после закрытия
 * последнего этапа участка повисает — здесь он находится и называется.
 */
describe('rollsAwaitingFate / rollsFateBlock (27.09, п. 2)', () => {
  const stage = { id: 's-cut', department_id: 'd-cut' };
  const noOthers = [{ stages: [{ id: 's-cut', status: 'in_progress', department_id: 'd-cut' }] }] as never;
  const mats = [fabric({ rolls: [
    bare(1, { status: 'in_use', qty: 20, qty_left: 5 }),
    bare(2, { status: 'in_use', qty: 20, qty_left: 0 }),
    bare(3, { status: 'used', qty: 20, qty_left: 4, leftover_kind: 'usable' }),
    bare(4, { status: 'in_use', qty: null, qty_left: null }),
    metred(5, { status: 'in_use', length_left_m: 3.456, qty_left: 1.49 }),
  ] })];

  it('находит рулон «в работе» с остатком и без вида — и только его', () => {
    const pending = rollsAwaitingFate(mats, 'i1', stage, noOthers);
    expect(pending.map((p) => p.roll.id)).toEqual(['r1', 'r5']);
  });

  it('пока в заказе открыт другой этап того же участка — решать рано', () => {
    const others = [{ stages: [
      { id: 's-cut', status: 'in_progress', department_id: 'd-cut' },
      { id: 's-cut-2', status: 'waiting', department_id: 'd-cut' },
    ] }] as never;
    expect(rollsAwaitingFate(mats, 'i1', stage, others)).toEqual([]);
    // Открытый этап ДРУГОГО участка не мешает
    const sew = [{ stages: [
      { id: 's-cut', status: 'in_progress', department_id: 'd-cut' },
      { id: 's-sew', status: 'waiting', department_id: 'd-sew' },
    ] }] as never;
    expect(rollsAwaitingFate(mats, 'i1', stage, sew)).toHaveLength(2);
  });

  it('текст называет рулон, остаток и что нажать — слово в слово с сервером', () => {
    const text = rollsFateBlock(rollsAwaitingFate(mats, 'i1', stage, noOthers));
    // Рулон с метражом — в метрах (как round(x, 2) на сервере), без него — в кг
    expect(text).toBe('Не решена судьба остатка: Рулон №1 (5 кг), Рулон №5 (3,46 м) — нажмите «Завершить рулон» и выберите: оставить пригодный остаток или списать непригодный.');
    expect(rollsFateBlock([])).toBeNull();
  });
});
