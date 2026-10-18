/**
 * ПРИМЕРЫ РАСХОДА ТКАНИ ПО РУЛОНАМ (правки 19.10, «Закрой»).
 *
 * Общие для клиента и сервера: модель формы (`cutUsage.ts`) проверяется
 * на них в `cutUsage.test.ts`, а проба сдачи закроя
 * (`supabase/probes/erp_cut_result_once.sql`) повторяет те же входы и те же
 * итоги — одно число в форме и в экономике заказа.
 *
 * Только данные: никакой логики, чтобы зеркало SQL читалось построчно.
 */

import type { RollUsageRow } from './cutUsage';

export interface CutUsageExampleRoll {
  id: string;
  seq: number;
  /** Доступно на начало работы, м (`length_left_m`) */
  availableM: number;
}

export interface CutUsageExampleMaterial {
  id: string;
  name: string;
  color: string;
  /** Цена за погонный метр, ₽ */
  pricePerM: number;
  rolls: CutUsageExampleRoll[];
}

export interface CutUsageExampleExpect {
  materialId: string;
  cutM: number;
  scrapM: number;
  totalM: number;
  usableLeftM: number;
  cutCost: number;
  scrapCost: number;
  avgPerGood: number | null;
  avgScope: 'color' | 'item';
}

export interface CutUsageExample {
  name: string;
  materials: CutUsageExampleMaterial[];
  rows: RollUsageRow[];
  /** Таблица выпуска «Результат кроя»: годные по цвету и размеру */
  good: { color: string; size: string; qty: number }[];
  /** Строки расхода, которые уйдут на сервер: рулон → метры */
  payloadM: Record<string, number>;
  expected: CutUsageExampleExpect[];
}

const FOOTER: CutUsageExampleMaterial = {
  id: 'm-footer',
  name: 'Футер 3-нитка',
  color: 'Чёрный',
  pricePerM: 400,
  rolls: [
    { id: 'r-1', seq: 1, availableM: 50 },
    { id: 'r-2', seq: 2, availableM: 50 },
    { id: 'r-3', seq: 3, availableM: 50 },
  ],
};

/** Цвет строк выпуска записан иначе, чем у материала: «черный» против «Чёрный» */
const GOOD_100 = [
  { color: 'черный', size: 'M', qty: 60 },
  { color: 'черный', size: 'L', qty: 40 },
];

/** Пример документа: полностью / частично, остаток 12 м пригоден / не использован */
export const DOC_EXAMPLE: CutUsageExample = {
  name: '3×50 м: полностью, остаток 12 пригоден, не использован',
  materials: [FOOTER],
  rows: [
    { rollId: 'r-1', materialId: 'm-footer', use: 'full', leftoverM: null, fate: null },
    { rollId: 'r-2', materialId: 'm-footer', use: 'partial', leftoverM: 12, fate: 'usable' },
    { rollId: 'r-3', materialId: 'm-footer', use: 'unused', leftoverM: null, fate: null },
  ],
  good: GOOD_100,
  payloadM: { 'r-1': 50, 'r-2': 38 },
  expected: [{
    materialId: 'm-footer', cutM: 88, scrapM: 0, totalM: 88, usableLeftM: 62,
    cutCost: 35200, scrapCost: 0, avgPerGood: 0.88, avgScope: 'color',
  }],
};

/** То же, но остаток 12 м — малый, списывается в отходы */
export const DOC_SCRAP_EXAMPLE: CutUsageExample = {
  name: '3×50 м: остаток 12 м списан',
  materials: [FOOTER],
  rows: [
    { rollId: 'r-1', materialId: 'm-footer', use: 'full', leftoverM: null, fate: null },
    { rollId: 'r-2', materialId: 'm-footer', use: 'partial', leftoverM: 12, fate: 'scrap' },
    { rollId: 'r-3', materialId: 'm-footer', use: 'unused', leftoverM: null, fate: null },
  ],
  good: GOOD_100,
  payloadM: { 'r-1': 50, 'r-2': 38 },
  expected: [{
    materialId: 'm-footer', cutM: 88, scrapM: 12, totalM: 100, usableLeftM: 50,
    cutCost: 35200, scrapCost: 4800, avgPerGood: 1, avgScope: 'color',
  }],
};

/** Полотно и рибана одной позиции: два итога, годные не удваиваются */
export const FABRIC_RIB_EXAMPLE: CutUsageExample = {
  name: 'полотно + рибана',
  materials: [
    { ...FOOTER, rolls: [FOOTER.rolls[0]] },
    {
      id: 'm-rib', name: 'Рибана', color: 'Чёрный', pricePerM: 300,
      rolls: [{ id: 'r-rib', seq: 1, availableM: 10 }],
    },
  ],
  rows: [
    { rollId: 'r-1', materialId: 'm-footer', use: 'full', leftoverM: null, fate: null },
    { rollId: 'r-rib', materialId: 'm-rib', use: 'partial', leftoverM: 6, fate: 'usable' },
  ],
  good: GOOD_100,
  payloadM: { 'r-1': 50, 'r-rib': 4 },
  expected: [
    {
      materialId: 'm-footer', cutM: 50, scrapM: 0, totalM: 50, usableLeftM: 0,
      cutCost: 20000, scrapCost: 0, avgPerGood: 0.5, avgScope: 'color',
    },
    {
      materialId: 'm-rib', cutM: 4, scrapM: 0, totalM: 4, usableLeftM: 6,
      cutCost: 1200, scrapCost: 0, avgPerGood: 0.04, avgScope: 'color',
    },
  ],
};

export const CUT_USAGE_EXAMPLES: readonly CutUsageExample[] = [
  DOC_EXAMPLE, DOC_SCRAP_EXAMPLE, FABRIC_RIB_EXAMPLE,
];
