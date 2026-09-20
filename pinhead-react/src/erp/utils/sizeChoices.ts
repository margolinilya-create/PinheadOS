import type { SizeGridRow } from '../types';
import { SIZE_PRESETS } from './orderForm';
import { gridCells, gridSizes, NO_COLOR } from './sizeGrid';

/**
 * ОТКУДА ЦЕХ БЕРЁТ СПИСОК РАЗМЕРОВ (правка заказчика 20.09, пп. 7 и 8).
 *
 * ПОЧЕМУ ЭТОТ МОДУЛЬ ВООБЩЕ ПОЯВИЛСЯ. Размерный факт цехов (правки 16.09)
 * включался ТОЛЬКО при непустой `erp_order_items.size_grid`: закрой брал
 * ячейки сетки, швейка — размерные строки предыдущего этапа. На бою сетки
 * нет у 21 позиции из 49, и на такой позиции обе формы схлопывались в одно
 * поле «Скроено, шт» / «Сделано, шт», а поле стоимости сборки не рисовалось
 * вовсе — оно жило внутри размерной ветки. Заказчик проверял ровно на такой
 * позиции («тест», футболка, 81 шт) и увидел ту самую картину, которую
 * описал в документе как «размеры не фиксируются».
 *
 * РЕШЕНИЕ: сетка позиции — ПРЕДПОЧТЕНИЕ, а не условие. Есть сетка — размеры
 * берутся из неё (и цвет вместе с ними); нет — цех выбирает из стандартной
 * шкалы и может дописать свой. Иначе работа цеха зависела бы от того,
 * заполнил ли менеджер сетку месяц назад, а исправить это задним числом
 * некому: заказ уже в производстве.
 *
 * ЧТО ЗДЕСЬ НЕ ЖИВЁТ: суммы, потолки и проверки. Это список ВАРИАНТОВ
 * и ничего больше — количества считают `cutRolls` и `stageSizes`.
 */

/** Один вариант размера в селекте цеха */
export interface SizeChoice {
  /** Что пишется в отчёт (`erp_stage_report_sizes.size`) */
  size: string;
  /** Цвет строки сетки; `NO_COLOR` — позиция без цветового деления */
  color: string;
  /** Подпись человеку: «M» либо «M · чёрный», когда цветов несколько */
  label: string;
  /** Сколько этого размера в заказе; `null` — сетки нет, сравнивать не с чем */
  planned: number | null;
}

/** Ключ строки: цвет и размер вместе — у двух цветов один размер это две строки */
export function choiceKey(choice: Pick<SizeChoice, 'color' | 'size'>): string {
  return `${choice.color}|${choice.size}`;
}

/**
 * Варианты размеров для формы цеха.
 *
 * Порядок: сначала то, что есть в сетке позиции (в порядке шкалы, с цветом),
 * затем — остальная стандартная шкала, если сетки нет. Смешивать их незачем:
 * когда сетка есть, шить размер не из заказа — это ошибка ввода, а не выбор.
 */
export function sizeChoicesFor(grid: SizeGridRow[] | null | undefined): SizeChoice[] {
  const cells = gridCells(grid);
  if (cells.length > 0) {
    const colors = new Set(cells.map((c) => c.color));
    const manyColors = colors.size > 1 || !colors.has(NO_COLOR);
    return cells.map((cell) => ({
      size: cell.size,
      color: cell.color,
      label: manyColors && cell.color !== NO_COLOR
        ? `${cell.size} · ${cell.color}`
        : cell.size,
      planned: cell.qty,
    }));
  }
  /**
   * Сетки нет — стандартная шкала. Взрослая и детская вместе: у цеха
   * в одном заказе бывает и то и другое, а «какая шкала у этой позиции»
   * без сетки никто не объявлял.
   */
  return [...SIZE_PRESETS.adult, ...SIZE_PRESETS.kids].map((size) => ({
    size,
    color: NO_COLOR,
    label: size,
    planned: null,
  }));
}

/** Есть ли у позиции размерная сетка — от этого зависит подпись «в заказе» */
export function hasPlannedSizes(grid: SizeGridRow[] | null | undefined): boolean {
  return gridSizes(grid).length > 0;
}

/**
 * Свободный размер, введённый руками.
 *
 * Обрезается и приводится к верхнему регистру у буквенных обозначений:
 * «m» и «M» — один размер, и две строки из-за регистра разошлись бы в
 * аналитике молча. Числовые детские («98») регистра не имеют и не трогаются.
 */
export function normalizeSize(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  return /[a-zA-Zа-яА-Я]/.test(text) ? text.toUpperCase() : text;
}

/**
 * Занят ли размер в этой строке-владельце (рулоне либо таблице).
 *
 * Документ требует: «Один и тот же размер внутри одного рулона не должен
 * добавляться дважды. Если размер уже выбран в этом рулоне, система должна
 * предложить изменить количество в существующей строке».
 */
export function isSizeTaken(
  rows: readonly { size: string; color?: string }[] | null | undefined,
  candidate: Pick<SizeChoice, 'color' | 'size'>,
  exceptIndex = -1,
): boolean {
  return (rows ?? []).some((row, i) => i !== exceptIndex
    && row.size === candidate.size
    && (row.color ?? NO_COLOR) === candidate.color);
}

/**
 * Первые свободные варианты — ими заполняются строки при добавлении рулона.
 *
 * Документ: «При добавлении рулона сразу показывать две строки размеров, так
 * как это основной рабочий сценарий». Когда свободных вариантов меньше,
 * отдаётся сколько есть: пустая строка с «выберите размер» лучше, чем строка
 * с размером, который уже занят соседней.
 */
export function freeChoices(
  choices: readonly SizeChoice[],
  taken: readonly { size: string; color?: string }[],
  count: number,
): SizeChoice[] {
  const out: SizeChoice[] = [];
  for (const choice of choices) {
    if (out.length >= count) break;
    if (isSizeTaken(taken, choice) || isSizeTaken(out, choice)) continue;
    out.push(choice);
  }
  return out;
}
