/**
 * РАСКРОЙ ПО РУЛОНАМ (правка заказчика 16.09, п. 4; расход В МЕТРАХ —
 * правка 27.09, п. 4).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «При сдаче результата закройщик должен фиксировать
 * данные в структуре: „Рулон — фактический расход ткани — количество
 * скроенных изделий по каждому размеру — итого с рулона"… Рулоны/партии
 * материала НЕ ВВОДЯТСЯ ВРУЧНУЮ. ERP должна подтягивать в форму те рулоны
 * или партии материала, которые склад фактически передал в закрой по данному
 * заказу».
 *
 * РАСХОД — В ПОГОННЫХ МЕТРАХ ПОЛНОЙ ШИРИНЫ (правка 27.09, п. 4): «в блоке
 * каждого рулона заменить поле „Фактический расход, кг" на „Фактический
 * расход, м"… Закройщик указывает фактически израсходованные погонные метры
 * полотна полной ширины, включая отходы раскладки в этом отрезе». Килограммы
 * считает сервер по коэффициенту рулона; здесь они только показываются
 * как расчётные (`fabricMetres`).
 *
 * ОТКУДА БЕРУТСЯ РУЛОНЫ. Из материалов ПОЗИЦИИ (`materialsForItem` — тот же
 * отбор, что у материального гейта участка), у которых приёмка вынесла
 * вердикт. «Склад передал в закрой» сегодня выражается именно этим: отдельного
 * действия «выдать рулон в цех» на складе нет, и заводить под него колонку,
 * которую никто не пишет, значит завести механизм, которому нечем питаться.
 *
 * ИЗРАСХОДОВАННЫЕ РУЛОНЫ НЕ ПРЕДЛАГАЮТСЯ (`status = 'used'` ставит отчёт закроя),
 * кроме закрытых с ПРИГОДНЫМ остатком > 0: с него кроят следующей сдачей,
 * «доступно» = остаток (правки 19.10). Уже выбранный в текущей форме рулон
 * остаётся видимым всегда — иначе строка исчезала бы из-под рук.
 */

import type { ErpItemStage, ErpMaterial, ErpMaterialRoll, SizeGridRow } from '../types';
import { materialsForItem } from './routes';
import { gridCells } from './sizeGrid';
import type { SizeCell } from './sizeGrid';
import { cellKey as cellKeyOf } from './cellKey';
import {
  roundM, rollAvailableM, rollWorkingLength,
} from './fabricMetres';

/** Рулон вместе с материалом, которому он принадлежит — для подписи в форме */
export interface RollOption {
  roll: ErpMaterialRoll;
  material: ErpMaterial;
  /** «Рулон №3 · Футер 3-нитка · чёрный · арт. 1234» */
  label: string;
  /**
   * Рулон ДРУГОГО заказа — пригодный остаток, взятый в этот (правка 28.09):
   * «если рулон используется в нескольких заказах, каждый следующий заказ
   * получает только его доступный остаток». Заголовок исходного заказа.
   */
  fromOrder?: string | null;
}

function acceptedForCutting(m: ErpMaterial): boolean {
  return m.accept_status === 'accepted_full' || m.accept_status === 'accepted_partial';
}

/** Подпись рулона: номер и по какому материалу он пришёл */
export function rollLabel(roll: ErpMaterialRoll, material: ErpMaterial): string {
  const parts = [roll.label, material.fact_name || material.name];
  const color = material.fact_color || material.color;
  if (color) parts.push(color);
  const article = material.fact_article || material.article;
  if (article) parts.push(`арт. ${article}`);
  return parts.join(' · ');
}

/**
 * Рулоны, которые можно выбрать в форме закроя.
 *
 * `keepIds` — уже выбранные: они остаются в списке, даже если закрыты
 * предыдущей сдачей, иначе строка исчезнет прямо во время заполнения.
 */
export function rollsForItem(
  materials: ErpMaterial[] | null | undefined,
  itemId: string | null | undefined,
  keepIds: readonly string[] = [],
  /** Рулоны других заказов (`foreignRollOptions`): пригодные остатки и уже взятые */
  extra: readonly RollOption[] = [],
): RollOption[] {
  const keep = new Set(keepIds);
  const out: RollOption[] = [];
  for (const option of extra) {
    const reusable = option.roll.status === 'used' && option.roll.leftover_kind === 'usable';
    if (option.roll.status === 'used' && !reusable && !keep.has(option.roll.id)) continue;
    out.push(option);
  }
  for (const material of materialsForItem(materials, itemId)) {
    if (material.kind !== 'fabric') continue;
    if (!acceptedForCutting(material)) continue;
    for (const roll of material.rolls ?? []) {
      const reusable = roll.leftover_kind === 'usable' && Number(roll.length_left_m ?? roll.qty_left ?? 0) > 0;
      if (roll.status === 'used' && !reusable && !keep.has(roll.id)) continue;
      out.push({ roll, material, label: rollLabel(roll, material) });
    }
  }
  // Свои рулоны — по номеру, чужие остатки — после своих
  return out.sort((a, b) => Number(Boolean(a.fromOrder)) - Number(Boolean(b.fromOrder))
    || a.roll.seq - b.roll.seq);
}

/** Ткань позиции принята общим весом, без рулонов (правка 01.10, п. 1): их добавляет склад */
export function fabricAcceptedWithoutRolls(
  materials: ErpMaterial[] | null | undefined,
  itemId: string | null | undefined,
): boolean {
  return materialsForItem(materials, itemId).some(
    (m) => m.kind === 'fabric' && acceptedForCutting(m) && (m.rolls ?? []).length === 0,
  );
}

// Рулоны чужих заказов — `utils/foreignRolls` (ратчет размера, правка 28.09)
export { foreignRollOptions } from './foreignRolls';
export type { ForeignRollRow } from './foreignRolls';

/** Ключ ячейки размера — тот же, что в остальных формах раздела */
export function cellKey(cell: Pick<SizeCell, 'color' | 'size'>): string {
  return cellKeyOf(cell.color, cell.size);
}

/** Ячейки размерной сетки позиции — строки таблицы внутри рулона */
export function sizeCellsOf(grid: SizeGridRow[] | null | undefined): SizeCell[] {
  return gridCells(grid);
}

/**
 * Доступно на начало работы, м: остаток рулона по серверу, а у нетронутого —
 * весь рабочий метраж. `null` — метража нет (рулон без параметров).
 */
export function rollAvailable(option: Pick<RollOption, 'roll' | 'material'> | null | undefined): number | null {
  if (!option) return null;
  return rollAvailableM(option.roll, option.material);
}

/**
 * Остаток рулона после этой сдачи, м: доступно на начало работы − расход.
 *
 * `null` — метража у рулона нет (принят без параметров), и вычитать не из
 * чего: прочерк честнее выдуманного числа. Уже израсходованное учтено
 * в доступном — с рулона кроят в несколько заходов.
 */
export function rollLeft(
  option: Pick<RollOption, 'roll' | 'material'> | null | undefined,
  lengthUsed: number | string | null | undefined,
): number | null {
  const base = rollAvailable(option);
  if (base === null) return null;
  const used = Math.max(Number(lengthUsed) || 0, 0);
  // Копим и округляем один раз: 20 − 19.4 без этого даёт 0.6000000000000014
  return Math.max(roundM(base - used), 0);
}

/** «5,00 м» с запятой — слово в слово с серверным `round(x, 2)::text` */
export function metresText(n: number): string {
  return `${roundM(n).toFixed(2).replace('.', ',')} м`;
}

/**
 * РУЛОНЫ, У КОТОРЫХ НЕ РЕШЕНА СУДЬБА ОСТАТКА (правка заказчика 27.09, п. 2).
 *
 * «Сейчас этап закройки можно завершить при наличии остатка по рулону без
 * указания его пригодности. Из-за этого пригодный остаток не попадает
 * в раздел „Остатки ткани"». Рулон, оставленный «в работе» прежней сдачей
 * (галочку «работа закончена» не поставили), после закрытия этапа повисает:
 * ни в остатках (там только `usable`), ни в экономике.
 *
 * Пока в заказе открыт ДРУГОЙ этап того же участка (соседняя позиция
 * кроится с того же рулона), решать рано — список пуст. Остаток — в метрах,
 * а у рулона без метража (принят до 27.09 п. 4) — в килограммах; рулон
 * без того и другого остатка не имеет (fail-open). Материалы — те же, что
 * видит форма (`materialsForItem`: заказа целиком и этой позиции).
 */
export function rollsAwaitingFate(
  materials: readonly ErpMaterial[] | null | undefined,
  itemId: string | null | undefined,
  stage: Pick<ErpItemStage, 'id'> & { department_id?: string | null },
  orderItems: readonly { stages?: readonly Pick<ErpItemStage, 'id' | 'status' | 'department_id'>[] }[] | null | undefined,
  /** Рулоны других заказов, взятые этим (правка 28.09) — их судьбу решает взявший */
  extra: readonly RollOption[] = [],
): RollOption[] {
  const othersOpen = (orderItems ?? []).some((it) => (it.stages ?? []).some(
    (s) => s.id !== stage.id
      && s.department_id === stage.department_id
      && s.status !== 'done' && s.status !== 'skipped',
  ));
  if (othersOpen) return [];
  /**
   * ОХВАТ — ВСЕ МАТЕРИАЛЫ ЗАКАЗА, как у сервера (`erp_stage_rolls_fate_block`,
   * правка 28.09). Прежде форма брала только материалы этой позиции, и рулон
   * соседней позиции, оставленный «в работе», держал закрытие последнего
   * закроя без единой кнопки в интерфейсе — выход был только аварийный.
   * `itemId` больше не сужает список: решать всё равно ему.
   */
  void itemId;
  const pending = (roll: ErpMaterialRoll) => roll.status === 'in_use'
    && Number(roll.length_left_m ?? roll.qty_left ?? 0) > 0 && !roll.leftover_kind;
  const out: RollOption[] = [];
  for (const material of materials ?? []) {
    for (const roll of material.rolls ?? []) {
      if (pending(roll)) out.push({ roll, material, label: rollLabel(roll, material) });
    }
  }
  for (const option of extra) if (pending(option.roll)) out.push(option);
  return out.sort((a, b) => a.roll.seq - b.roll.seq);
}

/** Остаток рулона для подписи: метры, а у рулона без метража — килограммы */
export function rollLeftText(roll: ErpMaterialRoll, material: ErpMaterial): string {
  if (roll.length_left_m !== null && roll.length_left_m !== undefined) {
    return metresText(Number(roll.length_left_m));
  }
  const unit = roll.unit ?? material.unit;
  return `${roll.qty_left}${unit ? ` ${unit}` : ''}`;
}

/**
 * Почему закрой нельзя закрыть по рулонам, или `null`. Слова совпадают
 * с серверным `erp_stage_rolls_fate_block` — один текст в кнопке и в отказе.
 */
export function rollsFateBlock(pending: readonly RollOption[]): string | null {
  if (pending.length === 0) return null;
  const list = pending
    .map(({ roll, material }) => `${roll.label} (${rollLeftText(roll, material)})`)
    .join(', ');
  return `Не решена судьба остатка: ${list} — нажмите «Завершить рулон» и выберите: оставить пригодный остаток или списать непригодный.`;
}

/** Есть ли у рулона рабочий метраж — то, без чего расход в метрах не записать */
export function rollHasMetres(option: Pick<RollOption, 'roll' | 'material'> | null | undefined): boolean {
  return Boolean(option && rollWorkingLength(option.roll, option.material)?.stored);
}
