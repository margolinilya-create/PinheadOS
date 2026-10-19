/**
 * РАСХОД ТКАНИ ПО РУЛОНАМ — МОДЕЛЬ ФОРМЫ ЗАКРОЯ (правки 19.10, «Закрой»).
 *
 * Выпуск («Результат кроя») вводится ОДИН раз таблицей позиции, а у рулона
 * остаётся только режим использования (Р5):
 *   · «Не использован» — с рулона не кроили, на сервер он не уходит;
 *   · «Полностью» — расход = доступно на начало работы;
 *   · «Частично» — закройщик вводит остаток, расход = доступно − остаток,
 *     и обязан решить судьбу остатка: пригоден (остаётся на складе)
 *     или малый (спишется в отходы).
 *
 * Средний расход — ПО МАТЕРИАЛУ (Р6): полотно и рибана отдельно, годные
 * не удваиваются. Знаменатель — годные строки выпуска того же цвета, что
 * у материала (без регистра, пробелов и «ё/е»); совпадений нет — все годные
 * сдачи с пометкой «по всей позиции». Средний = (расход + списание) / годные.
 *
 * Чистые функции без стора и React: их читают форма (Task 4) и пример
 * для пробы сервера (`cutUsage.examples.ts`).
 */

import type { RollOption } from './cutRolls';
import { rollAvailableM, rollPricePerM, roundM } from './fabricMetres';

export type RollUse = 'unused' | 'full' | 'partial';
export type LeftoverFate = 'usable' | 'scrap';

/** Строка рулона в форме: режим, остаток и его судьба */
export interface RollUsageRow {
  rollId: string;
  materialId: string;
  use: RollUse;
  /** Остаток после кроя, м — только у «Частично» */
  leftoverM: number | null;
  /** Судьба остатка — только у «Частично» */
  fate: LeftoverFate | null;
}

/** Строка рулона для `erp_stage_submit_report` (`p_rolls`), без размеров */
export interface CutRollPayload {
  roll_id: string;
  material_id: string;
  length_used_m: number;
  finished: true;
  leftover?: LeftoverFate | null;
  leftover_measured_m?: null;
}

/** Итог по одному материалу */
export interface MaterialUsageTotal {
  materialId: string;
  /** Расход на крой, м */
  cutM: number;
  /** Списано малым остатком, м */
  scrapM: number;
  /** Всего ушло: крой + списание, м */
  totalM: number;
  /** Пригодный остаток после сдачи: частичные «пригоден» + неиспользованные, м */
  usableLeftM: number;
  cutCost: number;
  scrapCost: number;
  /** Метров на одно годное изделие; `null` — годных ещё нет */
  avgPerGood: number | null;
  /** Знаменатель: годные цвета материала или вся позиция */
  avgScope: 'color' | 'item';
}

/** Допуск сравнения метров: ввод округляется до сотых */
const EPS_M = 0.005;

function leftoverOf(row: RollUsageRow): number | null {
  const v = row.leftoverM;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

/** Расход с рулона, м: не использован — 0, полностью — доступно, частично — доступно − остаток */
export function rollUsedM(availableM: number, row: RollUsageRow): number {
  if (row.use === 'full') return roundM(Math.max(availableM, 0));
  if (row.use !== 'partial') return 0;
  const left = leftoverOf(row) ?? 0;
  return Math.max(roundM(availableM - left), 0);
}

/**
 * Почему строку рулона нельзя сдать; пусто — можно. Тексты называют число
 * доступного: «уточните метраж» без него отправляет закройщика искать рулон.
 */
export function rollUsageErrors(availableM: number, row: RollUsageRow): string[] {
  if (row.use !== 'partial') return [];
  const errors: string[] = [];
  const left = leftoverOf(row);
  if (left === null || left <= 0) {
    errors.push('Введите остаток, м');
  } else if (left > availableM + EPS_M) {
    errors.push(`Остаток больше доступного (${String(roundM(availableM)).replace('.', ',')} м) — уточните метраж рулона`);
  } else if (Math.abs(left - availableM) <= EPS_M) {
    errors.push('Остаток равен доступному — выберите «Не использован»');
  }
  if (!row.fate) errors.push('Выберите: остаток пригоден или малый остаток');
  return errors;
}

/** «Использованы полностью» для выбранных строк: новые объекты, прочие строки — как были */
export function markAllFull(rows: RollUsageRow[], ids: readonly string[]): RollUsageRow[] {
  const pick = new Set(ids);
  return rows.map((row) => (pick.has(row.rollId)
    ? { ...row, use: 'full', leftoverM: null, fate: null }
    : row));
}

/** Цвет для сравнения: нижний регистр, без пробелов, «ё» → «е» */
export function normColor(s: string): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/ё/g, 'е');
}

function availableOf(option: RollOption): number {
  return rollAvailableM(option.roll, option.material) ?? 0;
}

const roundRub = (n: number): number => Math.round(n * 100) / 100;

interface Acc {
  materialId: string;
  color: string;
  cutM: number;
  scrapM: number;
  usableLeftM: number;
  cutCost: number;
  scrapCost: number;
}

/** Годные для среднего: цвета материала, а без совпадений — вся сдача */
function denominator(
  color: string,
  goodByColor: Map<string, number>,
  goodTotal: number,
): { good: number; scope: 'color' | 'item' } {
  const want = normColor(color);
  let matched = false;
  let good = 0;
  if (want) {
    for (const [key, qty] of goodByColor) {
      if (normColor(key) !== want) continue;
      matched = true;
      good += Math.max(Number(qty) || 0, 0);
    }
  }
  return matched ? { good, scope: 'color' } : { good: Math.max(goodTotal, 0), scope: 'item' };
}

/** Итоги расхода по материалам — в порядке рулонов формы */
export function usageTotals(
  options: RollOption[],
  rows: RollUsageRow[],
  goodByColor: Map<string, number>,
  goodTotal: number,
): MaterialUsageTotal[] {
  const byRoll = new Map(rows.map((r) => [r.rollId, r]));
  const acc = new Map<string, Acc>();
  for (const option of options) {
    const { material } = option;
    let a = acc.get(material.id);
    if (!a) {
      a = {
        materialId: material.id, color: material.fact_color || material.color || '',
        cutM: 0, scrapM: 0, usableLeftM: 0, cutCost: 0, scrapCost: 0,
      };
      acc.set(material.id, a);
    }
    const available = availableOf(option);
    const price = rollPricePerM(option.roll, material) ?? 0;
    const row = byRoll.get(option.roll.id);
    const use = row?.use ?? 'unused';
    if (use === 'unused' || !row) {
      a.usableLeftM += available;
      continue;
    }
    const used = rollUsedM(available, row);
    a.cutM += used;
    a.cutCost += used * price;
    if (use === 'partial') {
      const left = Math.max(leftoverOf(row) ?? 0, 0);
      if (row.fate === 'scrap') {
        a.scrapM += left;
        a.scrapCost += left * price;
      } else {
        a.usableLeftM += left;
      }
    }
  }
  return [...acc.values()].map((a) => {
    const cutM = roundM(a.cutM);
    const scrapM = roundM(a.scrapM);
    const totalM = roundM(a.cutM + a.scrapM);
    const { good, scope } = denominator(a.color, goodByColor, goodTotal);
    return {
      materialId: a.materialId,
      cutM,
      scrapM,
      totalM,
      usableLeftM: roundM(a.usableLeftM),
      cutCost: roundRub(a.cutCost),
      scrapCost: roundRub(a.scrapCost),
      avgPerGood: good > 0 ? totalM / good : null,
      avgScope: scope,
    };
  });
}

/**
 * Строки рулонов для сервера: только использованные. Материал берётся
 * из рулона формы (сервер всё равно сверит его с рулоном). Остаток задан
 * вводом — отдельный замер не шлём.
 */
export function usagePayload(options: RollOption[], rows: RollUsageRow[]): CutRollPayload[] {
  const byId = new Map(options.map((o) => [o.roll.id, o]));
  const out: CutRollPayload[] = [];
  for (const row of rows) {
    if (row.use === 'unused') continue;
    const option = byId.get(row.rollId);
    if (!option) continue;
    const base = {
      roll_id: row.rollId,
      material_id: option.material.id,
      length_used_m: rollUsedM(availableOf(option), row),
      finished: true as const,
    };
    out.push(row.use === 'full'
      ? base
      : { ...base, leftover: row.fate, leftover_measured_m: null });
  }
  return out;
}
