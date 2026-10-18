import { describe, expect, it } from 'vitest';
import type { ErpMaterial, ErpMaterialRoll } from '../types';
import type { RollOption } from './cutRolls';
import {
  markAllFull, normColor, rollUsageErrors, rollUsedM, usagePayload, usageTotals,
} from './cutUsage';
import type { RollUsageRow } from './cutUsage';
import {
  DOC_EXAMPLE, DOC_SCRAP_EXAMPLE, FABRIC_RIB_EXAMPLE,
} from './cutUsage.examples';
import type { CutUsageExample } from './cutUsage.examples';

/**
 * РАСХОД ТКАНИ ПО РУЛОНАМ (правки 19.10, «Закрой»): выпуск вводится один раз
 * таблицей, у рулона — только режим «Не использован / Полностью / Частично».
 * Числа примеров — из `cutUsage.examples.ts`, их же повторяет проба сервера.
 */

function optionsOf(ex: CutUsageExample): RollOption[] {
  return ex.materials.flatMap((m) => {
    const material = {
      id: m.id, name: m.name, color: m.color, kind: 'fabric',
      fact_name: null, fact_color: null, fact_article: null, article: null,
    } as unknown as ErpMaterial;
    return m.rolls.map((r) => ({
      roll: {
        id: r.id, seq: r.seq, label: `Рулон №${r.seq}`, material_id: m.id,
        status: 'in_stock', length_left_m: r.availableM, price_per_m: m.pricePerM,
      } as unknown as ErpMaterialRoll,
      material,
      label: `Рулон №${r.seq} · ${m.name}`,
    }));
  });
}

function goodOf(ex: CutUsageExample): [Map<string, number>, number] {
  const map = new Map<string, number>();
  let total = 0;
  for (const g of ex.good) {
    map.set(g.color, (map.get(g.color) ?? 0) + g.qty);
    total += g.qty;
  }
  return [map, total];
}

function totalsOf(ex: CutUsageExample) {
  const [byColor, total] = goodOf(ex);
  return usageTotals(optionsOf(ex), ex.rows, byColor, total);
}

const row = (extra: Partial<RollUsageRow> = {}): RollUsageRow => ({
  rollId: 'r-1', materialId: 'm-footer', use: 'unused', leftoverM: null, fate: null, ...extra,
});

describe('usageTotals — итоги по материалу', () => {
  it('3×50 м: полностью / остаток 12 пригоден / не использован → 88, остатки 62, 0,88 на 100 годных', () => {
    expect(totalsOf(DOC_EXAMPLE)).toEqual(DOC_EXAMPLE.expected);
  });

  it('то же со списанием 12 м → cutM 88, scrapM 12, totalM 100, usableLeftM 50, средний 1', () => {
    expect(totalsOf(DOC_SCRAP_EXAMPLE)).toEqual(DOC_SCRAP_EXAMPLE.expected);
  });

  it('good = 0 → avgPerGood null, расход сохранён', () => {
    const [res] = usageTotals(optionsOf(DOC_EXAMPLE), DOC_EXAMPLE.rows, new Map(), 0);
    expect(res.avgPerGood).toBeNull();
    expect(res.cutM).toBe(88);
    expect(res.usableLeftM).toBe(62);
  });

  it('полотно + рибана — два итога, годные не удваиваются', () => {
    expect(totalsOf(FABRIC_RIB_EXAMPLE)).toEqual(FABRIC_RIB_EXAMPLE.expected);
  });

  it('цвет материала «Чёрный», строки «черный» → avgScope color', () => {
    const [byColor] = goodOf(DOC_EXAMPLE);
    byColor.set('Белый', 50);
    const [res] = usageTotals(optionsOf(DOC_EXAMPLE), DOC_EXAMPLE.rows, byColor, 150);
    expect(res.avgScope).toBe('color');
    expect(res.avgPerGood).toBe(0.88);
  });

  it('нет совпадения цвета → avgScope item', () => {
    const byColor = new Map([['Белый', 80], ['Синий', 20]]);
    const [res] = usageTotals(optionsOf(DOC_EXAMPLE), DOC_EXAMPLE.rows, byColor, 100);
    expect(res.avgScope).toBe('item');
    expect(res.avgPerGood).toBe(0.88);
  });
});

describe('usagePayload — строки рулонов для сервера', () => {
  it('по умолчанию все unused — payload пуст', () => {
    const options = optionsOf(DOC_EXAMPLE);
    const rows = options.map((o) => row({ rollId: o.roll.id }));
    expect(usagePayload(options, rows)).toEqual([]);
  });

  it('payload несёт material_id', () => {
    const payload = usagePayload(optionsOf(DOC_EXAMPLE), DOC_EXAMPLE.rows);
    expect(payload).toEqual([
      { roll_id: 'r-1', material_id: 'm-footer', length_used_m: 50, finished: true },
      {
        roll_id: 'r-2', material_id: 'm-footer', length_used_m: 38, finished: true,
        leftover: 'usable', leftover_measured_m: null,
      },
    ]);
    expect(Object.fromEntries(payload.map((p) => [p.roll_id, p.length_used_m])))
      .toEqual(DOC_EXAMPLE.payloadM);
  });

  it('у рибаны свой material_id, метры — из примера', () => {
    const payload = usagePayload(optionsOf(FABRIC_RIB_EXAMPLE), FABRIC_RIB_EXAMPLE.rows);
    expect(payload.map((p) => p.material_id)).toEqual(['m-footer', 'm-rib']);
    expect(Object.fromEntries(payload.map((p) => [p.roll_id, p.length_used_m])))
      .toEqual(FABRIC_RIB_EXAMPLE.payloadM);
  });
});

describe('markAllFull', () => {
  it('markAllFull не мутирует вход и меняет только выбранные', () => {
    const rows = [
      row({ rollId: 'a' }),
      row({ rollId: 'b', use: 'partial', leftoverM: 5, fate: 'usable' }),
      row({ rollId: 'c' }),
    ];
    const snapshot = structuredClone(rows);
    const out = markAllFull(rows, ['a', 'b']);
    expect(rows).toEqual(snapshot);
    expect(out).not.toBe(rows);
    expect(out[0]).toEqual(row({ rollId: 'a', use: 'full' }));
    expect(out[1]).toEqual(row({ rollId: 'b', use: 'full', leftoverM: null, fate: null }));
    expect(out[2]).toBe(rows[2]);
  });
});

describe('rollUsedM и rollUsageErrors', () => {
  it('расход: не использован 0, полностью — доступно, частично — доступно − остаток', () => {
    expect(rollUsedM(50, row())).toBe(0);
    expect(rollUsedM(50, row({ use: 'full' }))).toBe(50);
    expect(rollUsedM(50, row({ use: 'partial', leftoverM: 12 }))).toBe(38);
    expect(rollUsedM(46.3, row({ use: 'partial', leftoverM: 19.4 }))).toBe(26.9);
  });

  it('частично без остатка — «Введите остаток, м» и выбор пригодности', () => {
    expect(rollUsageErrors(50, row({ use: 'partial' }))).toEqual([
      'Введите остаток, м',
      'Выберите: остаток пригоден или малый остаток',
    ]);
  });

  it('остаток больше доступного — ошибка с доступным и уточнением метража', () => {
    expect(rollUsageErrors(50, row({ use: 'partial', leftoverM: 60, fate: 'usable' })))
      .toEqual(['Остаток больше доступного (50 м) — уточните метраж рулона']);
  });

  it('остаток = доступному — ошибка', () => {
    expect(rollUsageErrors(50, row({ use: 'partial', leftoverM: 50, fate: 'usable' })))
      .toEqual(['Остаток равен доступному — выберите «Не использован»']);
  });

  it('корректный частичный, полностью и не использован — без ошибок', () => {
    expect(rollUsageErrors(50, row({ use: 'partial', leftoverM: 12, fate: 'scrap' }))).toEqual([]);
    expect(rollUsageErrors(50, row({ use: 'full' }))).toEqual([]);
    expect(rollUsageErrors(50, row())).toEqual([]);
  });
});

describe('normColor', () => {
  it('нижний регистр, без пробелов, «ё» → «е»', () => {
    expect(normColor(' Тёмно Синий ')).toBe('темносиний');
    expect(normColor('ЧЁРНЫЙ')).toBe(normColor('черный'));
  });
});
