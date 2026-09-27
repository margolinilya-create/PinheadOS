/**
 * РАСКРОЙ ПО РУЛОНАМ (правка заказчика 16.09, п. 4).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «При сдаче результата закройщик должен фиксировать
 * данные в структуре: „Рулон — фактический расход ткани — количество
 * скроенных изделий по каждому размеру — итого с рулона"… Рулоны/партии
 * материала НЕ ВВОДЯТСЯ ВРУЧНУЮ. ERP должна подтягивать в форму те рулоны
 * или партии материала, которые склад фактически передал в закрой по данному
 * заказу».
 *
 * ОТКУДА БЕРУТСЯ РУЛОНЫ. Из материалов ПОЗИЦИИ (`materialsForItem` — тот же
 * отбор, что у материального гейта участка), у которых приёмка вынесла
 * вердикт. «Склад передал в закрой» сегодня выражается именно этим: отдельного
 * действия «выдать рулон в цех» на складе нет, и заводить под него колонку,
 * которую никто не пишет, значит завести механизм, которому нечем питаться.
 * Когда такое действие появится, поменяется ЭТА функция — одна, а не пять
 * мест разметки.
 *
 * ИЗРАСХОДОВАННЫЕ РУЛОНЫ НЕ ПРЕДЛАГАЮТСЯ. `status = 'used'` ставит сам отчёт
 * закроя («рулон израсходован»), и показывать его снова значит предлагать
 * кроить из того, чего нет. Но уже выбранный в текущей форме рулон остаётся
 * видимым всегда — иначе строка исчезала бы из-под рук.
 */

import type { ErpItemStage, ErpMaterial, ErpMaterialRoll, SizeGridRow } from '../types';
import { materialsForItem } from './routes';
import { gridCells, NO_COLOR } from './sizeGrid';
import type { SizeCell } from './sizeGrid';
import { cellKey as cellKeyOf } from './cellKey';

/** Рулон вместе с материалом, которому он принадлежит — для подписи в форме */
export interface RollOption {
  roll: ErpMaterialRoll;
  material: ErpMaterial;
  /** «Рулон №3 · Футер 3-нитка · чёрный · арт. 1234» */
  label: string;
}

/** Строка формы: один рулон, расход и раскрой по размерам */
export interface CutRollEntry {
  rollId: string;
  /** Фактический расход материала с этого рулона */
  qtyUsed: number;
  /** Сколько скроено по каждому размеру: ключ — «цвет + NUL + размер» */
  sizes: CutSizeRow[];
  /** Работа по рулону закончена — дальше с него не кроят */
  finished?: boolean;
  /**
   * Что делать с остатком (правка 21.09, п. 5): `usable` — «остаток пригоден»,
   * идёт в экономику заказа и остаётся на складе; `scrap` — «малый остаток,
   * не учитывать». Пусто — остатка нет либо работа по рулону не закончена.
   *
   * Автоматического порога в килограммах НЕТ: «автоматический порог
   * в килограммах пока не задавать» — решает закройщик.
   */
  leftover?: 'usable' | 'scrap' | null;
}

/**
 * Одна размерная строка внутри рулона (правка 20.09, п. 7).
 *
 * ПОЧЕМУ СПИСОК, А НЕ ОБЪЕКТ «ключ → количество», как было до 20.09.
 *
 * 1. Документ просит строки, которые закройщик ДОБАВЛЯЕТ и УДАЛЯЕТ:
 *    «при добавлении рулона сразу показывать две строки размеров… если
 *    размеров больше двух, добавить кнопку „Добавить размер"». У объекта
 *    нет ни порядка, ни пустой строки — а строка с ещё не выбранным
 *    размером это нормальное промежуточное состояние ввода.
 * 2. Объект требовал склеивать ключ и разбирать его обратно. Разделителем
 *    там стоит нулевой байт — приём верный (цвет из двух слов его
 *    переживает), но невидимый: в тексте файла он не отличим от опечатки,
 *    и первый же читатель принимает его за пробел. Явные поля снимают
 *    и склейку, и разбор.
 */
export interface CutSizeRow {
  size: string;
  color: string;
  qty: number;
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
): RollOption[] {
  const keep = new Set(keepIds);
  const out: RollOption[] = [];
  for (const material of materialsForItem(materials, itemId)) {
    if (material.kind !== 'fabric') continue;
    if (!acceptedForCutting(material)) continue;
    for (const roll of material.rolls ?? []) {
      if (roll.status === 'used' && !keep.has(roll.id)) continue;
      out.push({ roll, material, label: rollLabel(roll, material) });
    }
  }
  return out.sort((a, b) => a.roll.seq - b.roll.seq);
}

/** Ключ ячейки размера — тот же, что в остальных формах раздела */
export function cellKey(cell: Pick<SizeCell, 'color' | 'size'>): string {
  return cellKeyOf(cell.color, cell.size);
}

/** Ячейки размерной сетки позиции — строки таблицы внутри рулона */
export function sizeCellsOf(grid: SizeGridRow[] | null | undefined): SizeCell[] {
  return gridCells(grid);
}

/**
 * Итог по одному рулону: сколько изделий с него получено.
 *
 * Документ: «„Итого с рулона" считать автоматически как сумму количества
 * по всем размерным строкам этого рулона. Отдельно вручную это значение
 * не вводится». Поле, которое человек заполняет сам, разошлось бы
 * со строками на первой же правке.
 */
export function rollTotal(entry: CutRollEntry | null | undefined): number {
  return (entry?.sizes ?? []).reduce(
    (sum, row) => sum + Math.max(Number(row?.qty) || 0, 0), 0,
  );
}

/**
 * Остаток рулона после этой сдачи: первоначальный вес минус расход.
 *
 * `null` — вес рулона неизвестен (принят до правки 21.09), и вычитать не из
 * чего: прочерк честнее выдуманного числа. Уже израсходованное учитывается —
 * с рулона кроят в несколько заходов.
 */
export function rollLeft(
  roll: Pick<ErpMaterialRoll, 'qty' | 'qty_left'> | null | undefined,
  qtyUsed: number | string | null | undefined,
): number | null {
  const base = roll?.qty_left ?? roll?.qty;
  if (base === null || base === undefined) return null;
  const used = Math.max(Number(qtyUsed) || 0, 0);
  // Копим и округляем один раз: 20 − 19.4 без этого даёт 0.6000000000000014
  return Math.max(Math.round((Number(base) - used) * 1000) / 1000, 0);
}

export interface CutTotals {
  /** Всего скроено по всем рулонам */
  qty: number;
  /** Общий фактический расход ткани */
  used: number;
  /** Итог по каждому размеру: ключ ячейки → количество */
  bySize: Record<string, number>;
  /** Сколько рулонов заполнено */
  rolls: number;
}

/**
 * Автоматические итоги (документ: «ERP автоматически суммирует результат
 * по всем использованным рулонам и показывает: общее количество скроенных
 * изделий, итог по каждому размеру, общий фактический расход ткани»).
 */
export function cutTotals(entries: readonly CutRollEntry[] | null | undefined): CutTotals {
  const bySize: Record<string, number> = {};
  let qty = 0;
  let used = 0;
  let rolls = 0;

  for (const entry of entries ?? []) {
    const entryQty = rollTotal(entry);
    const entryUsed = Math.max(Number(entry?.qtyUsed) || 0, 0);
    if (entryQty > 0 || entryUsed > 0) rolls += 1;
    qty += entryQty;
    used += entryUsed;
    for (const row of entry?.sizes ?? []) {
      const n = Math.max(Number(row?.qty) || 0, 0);
      if (n > 0 && row?.size) {
        const key = cellKey({ color: row.color || NO_COLOR, size: row.size });
        bySize[key] = (bySize[key] ?? 0) + n;
      }
    }
  }
  // Расход — дробное число (метры, килограммы): копим и округляем один раз,
  // иначе 19.4 + 19.4 даёт 38.800000000000004 прямо в подписи цеху
  return { qty, used: Math.round(used * 1000) / 1000, bySize, rolls };
}

/**
 * Почему результат нельзя сдать. `null` — можно.
 *
 * Текст называет ЧИСЛА: «заполните расход» без указания рулона отправляет
 * закройщика перебирать строки заново.
 */
export function cutBlock(
  entries: readonly CutRollEntry[] | null | undefined,
  options: readonly RollOption[] = [],
): string | null {
  const list = entries ?? [];
  if (list.length === 0) return 'Добавьте рулон, с которого кроили';

  const seen = new Set<string>();
  for (const entry of list) {
    const option = options.find((o) => o.roll.id === entry.rollId);
    const name = option?.roll.label ?? 'рулон';
    if (!entry.rollId) return 'Выберите рулон в каждой строке';
    if (seen.has(entry.rollId)) return `${name} выбран дважды — объедините строки`;
    seen.add(entry.rollId);

    if (!(Number(entry.qtyUsed) > 0)) return `${name}: укажите фактический расход материала`;

    /**
     * РАСХОД НЕ БОЛЬШЕ ПРИНЯТОГО ВЕСА (правка 21.09, п. 2). Тот же гейт стоит
     * на сервере (22023) — здесь он нужен, чтобы закройщик увидел ошибку
     * до нажатия, а не после. Вес рулона может быть неизвестен (принят
     * до правки) — тогда потолка нет: остановка цеха из-за отсутствующего
     * поля хуже незамеченного перерасхода.
     */
    const roll = option?.roll;
    const cap = roll?.qty_left ?? roll?.qty;
    if (cap !== null && cap !== undefined && Number(entry.qtyUsed) > Number(cap) + 0.01) {
      return `${name}: в рулоне ${cap}, а списывается ${entry.qtyUsed} — расход больше остатка`;
    }

    /**
     * Размерные строки проверяются ПОИМЕННО (правка 20.09, п. 7): строка
     * без выбранного размера и два одинаковых размера в одном рулоне — это
     * разные ошибки ввода, и «укажите, сколько скроено» не объясняет ни ту,
     * ни другую.
     */
    const seenSize = new Set<string>();
    for (const row of entry.sizes ?? []) {
      const qty = Math.max(Number(row?.qty) || 0, 0);
      if (!row?.size) {
        if (qty > 0) return `${name}: выберите размер в строке с количеством`;
        continue; // пустая строка целиком — её просто не сохраняем
      }
      const key = cellKey({ color: row.color || NO_COLOR, size: row.size });
      if (seenSize.has(key)) {
        return `${name}: размер ${row.size} указан дважды — измените количество в первой строке`;
      }
      seenSize.add(key);
    }

    if (rollTotal(entry) <= 0) return `${name}: укажите, сколько изделий скроено`;

    /**
     * У ЗАКОНЧЕННОГО РУЛОНА С ОСТАТКОМ ВИД ОБЯЗАТЕЛЕН (правка 21.09, п. 5).
     * Без него остаток повисает: в экономику заказа он не попадает (там
     * считается только «пригоден»), а на складе не появляется. Молчание тут
     * означало бы потерянные килограммы — и никто бы не заметил.
     */
    if (entry.finished) {
      const left = rollLeft(option?.roll, entry.qtyUsed);
      if (left !== null && left > 0 && !entry.leftover) {
        return `${name}: остался ${left} — скажите, пригоден он или это малый остаток`;
      }
    }
  }
  return null;
}

/**
 * Разбивка для отчёта этапа: строки «цвет × размер» по всем рулонам.
 *
 * Считается ПО ВВЕДЁННЫМ СТРОКАМ, а не по ячейкам сетки позиции (правка
 * 20.09, п. 7): у позиции без сетки ячеек нет вовсе, и прежняя версия
 * возвращала пустой список — размерный факт закроя не сохранялся ни разу
 * (на бою `erp_stage_report_sizes` пуста при трёх заполненных рулонах).
 */
export function cutSizesPayload(
  entries: readonly CutRollEntry[] | null | undefined,
): { color: string; size: string; qty_good: number }[] {
  const byKey = new Map<string, { color: string; size: string; qty_good: number }>();
  for (const entry of entries ?? []) {
    for (const row of entry?.sizes ?? []) {
      const qty = Math.max(Number(row?.qty) || 0, 0);
      if (qty <= 0 || !row?.size) continue;
      const color = row.color || NO_COLOR;
      const key = cellKey({ color, size: row.size });
      const hit = byKey.get(key);
      if (hit) hit.qty_good += qty;
      else byKey.set(key, { color, size: row.size, qty_good: qty });
    }
  }
  return [...byKey.values()];
}

/** Строки рулонов для отчёта этапа */
export function cutRollsPayload(
  entries: readonly CutRollEntry[] | null | undefined,
  options: readonly RollOption[] = [],
): {
    roll_id: string; material_id: string | null; qty_used: number;
    finished: boolean; leftover: 'usable' | 'scrap' | null;
    sizes: { color: string; size: string; qty_good: number }[];
  }[] {
  return (entries ?? [])
    .filter((entry) => entry.rollId && rollTotal(entry) > 0)
    .map((entry) => {
      const option = options.find((o) => o.roll.id === entry.rollId);
      return {
        roll_id: entry.rollId,
        material_id: option?.material.id ?? null,
        qty_used: Math.max(Number(entry.qtyUsed) || 0, 0),
        finished: Boolean(entry.finished),
        /**
         * Вид остатка уезжает ТОЛЬКО при законченной работе: пока с рулона
         * ещё кроят, остаток промежуточный, и объявлять его «пригодным»
         * значило бы положить на склад то, что завтра дорежут.
         */
        leftover: entry.finished ? (entry.leftover ?? null) : null,
        // Строки берутся КАК ЕСТЬ: склейки ключа и обратного разбора
        // больше нет (см. комментарий к `CutSizeRow`).

        sizes: (entry.sizes ?? [])
          .filter((row) => row?.size && Math.max(Number(row.qty) || 0, 0) > 0)
          .map((row) => ({
            color: row.color || NO_COLOR,
            size: row.size,
            qty_good: Math.max(Number(row.qty) || 0, 0),
          })),
      };
    });
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
 * кроится с того же рулона), решать рано — список пуст. Рулон без веса
 * остатка не имеет (fail-open). Материалы — те же, что видит форма
 * (`materialsForItem`: заказа целиком и этой позиции).
 */
export function rollsAwaitingFate(
  materials: readonly ErpMaterial[] | null | undefined,
  itemId: string | null | undefined,
  stage: Pick<ErpItemStage, 'id'> & { department_id?: string | null },
  orderItems: readonly { stages?: readonly Pick<ErpItemStage, 'id' | 'status' | 'department_id'>[] }[] | null | undefined,
): RollOption[] {
  const othersOpen = (orderItems ?? []).some((it) => (it.stages ?? []).some(
    (s) => s.id !== stage.id
      && s.department_id === stage.department_id
      && s.status !== 'done' && s.status !== 'skipped',
  ));
  if (othersOpen) return [];
  const out: RollOption[] = [];
  for (const material of materialsForItem([...(materials ?? [])], itemId)) {
    for (const roll of material.rolls ?? []) {
      if (roll.status !== 'in_use') continue;
      if (!(Number(roll.qty_left ?? 0) > 0)) continue;
      if (roll.leftover_kind) continue;
      out.push({ roll, material, label: rollLabel(roll, material) });
    }
  }
  return out.sort((a, b) => a.roll.seq - b.roll.seq);
}

/**
 * Почему закрой нельзя закрыть по рулонам, или `null`. Слова совпадают
 * с серверным `erp_stage_rolls_fate_block` — один текст в кнопке и в отказе.
 */
export function rollsFateBlock(pending: readonly RollOption[]): string | null {
  if (pending.length === 0) return null;
  const list = pending
    .map(({ roll, material }) => {
      const unit = roll.unit ?? material.unit;
      return `${roll.label} (${roll.qty_left}${unit ? ` ${unit}` : ''})`;
    })
    .join(', ');
  return `Не решена судьба остатка: ${list} — отметьте «Остаток пригоден» или «Малый остаток, не учитывать».`;
}
