import { describe, it, expect } from 'vitest';
import type { ErpMaterial, ErpMaterialRoll } from '../types';
import {
  rollsAwaitingFate, rollsFateBlock, rollsForItem, rollLabel, rollLeft, rollAvailable,
} from './cutRolls';

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

  /**
   * Повторная сдача закроя с тем же рулоном (правки 19.10): прошлая сдача
   * закрыла рулон с пригодным остатком — с него кроят дальше, «доступно» =
   * текущий остаток. Малый остаток и израсходованный рулон не возвращаются.
   */
  it('свой рулон с пригодным остатком прошлой сдачи — в списке, доступно = length_left_m', () => {
    const m = fabric({
      rolls: [
        roll(1, { status: 'used', leftover_kind: 'usable', length_left_m: 12 }),
        roll(2, { status: 'used', leftover_kind: 'scrap', length_left_m: 3 }),
        roll(3, { status: 'used', leftover_kind: 'usable', length_left_m: 0 }),
      ],
    });
    const list = rollsForItem([m], 'i1');
    expect(list.map((o) => o.roll.id)).toEqual(['r1']);
    expect(rollAvailable(list[0])).toBe(12);
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
