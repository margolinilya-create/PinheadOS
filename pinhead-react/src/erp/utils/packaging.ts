import { PACKAGING_LABELS, STICKERS_LABELS } from '../types';
import type { PackagingType, StickersType } from '../types';

/**
 * Упаковка позиции — единственный источник правды.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. До правки заказчика 16.08 упаковка была ОДНОЙ настройкой
 * на весь заказ. Заказчик: «у разных изделий внутри одной сделки могут
 * отличаться тип пакета, размер пакета, расположение стикера, расположение
 * маркировки — упаковка должна задаваться именно на уровне изделия».
 *
 * Колонки заказа при этом НЕ переносились и не удалялись: их несут уже
 * заведённые заказы, и для заказа из одинаковых изделий одна общая настройка
 * по-прежнему удобнее, чем повторять её в каждой позиции. Значит появилось два
 * места, где может лежать ответ, — а два места без правила разрешения это
 * второй источник правды. Правило живёт здесь и только здесь, ровно как
 * `utils/tz.itemTzDocument` разрешает «ТЗ позиции → общее ТЗ заказа».
 *
 * Позиция со значением `inherit` (оно же значение по умолчанию) берёт упаковку
 * заказа. Именно `inherit`, а не пустое значение: `none` означает осознанное
 * «эту позицию не упаковывать», и отличить его от «не заполняли» иначе нельзя —
 * забытая позиция молча уехала бы в отгрузку без упаковки.
 */

/** Упаковка позиции с пометкой, откуда она взялась */
export interface ItemPackaging {
  type: PackagingType;
  note: string | null;
  /**
   * Размер выбранной упаковки, мм (правки 07.09, п. 16). Разрешается ТЕМ ЖЕ
   * правилом «своё → общее», но СВОИМ вопросом: позиция может брать тип
   * упаковки из заказа, а размер иметь свой (мешок под худи против пакета
   * под футболку в одной сделке). Поэтому размер не привязан к `inherited`
   * типа — у него свой флаг.
   */
  width_mm: number | null;
  height_mm: number | null;
  sizeInherited: boolean;
  /** true — значение пришло из заказа, у позиции своего нет */
  inherited: boolean;
}

interface OrderPackagingLike {
  packaging?: PackagingType | null;
  packaging_note?: string | null;
  packaging_width_mm?: number | null;
  packaging_height_mm?: number | null;
}

interface ItemPackagingLike {
  /** `inherit` — брать из заказа; у заказов до 16.08 колонки нет вовсе */
  packaging?: string | null;
  packaging_note?: string | null;
  packaging_width_mm?: number | null;
  packaging_height_mm?: number | null;
}

/** Размер задан, только когда заданы ОБЕ стороны: одна сторона — не размер */
function sizeOf(src: {
  packaging_width_mm?: number | null;
  packaging_height_mm?: number | null;
} | null | undefined): { width_mm: number; height_mm: number } | null {
  const w = Number(src?.packaging_width_mm) || 0;
  const h = Number(src?.packaging_height_mm) || 0;
  return w > 0 && h > 0 ? { width_mm: w, height_mm: h } : null;
}

export function itemPackaging(
  order: OrderPackagingLike | null | undefined,
  item: ItemPackagingLike | null | undefined,
): ItemPackaging {
  const own = item?.packaging;
  /**
   * Отсутствие поля читается как `inherit`, а не как «нет упаковки»: позиции,
   * заведённые до правки, колонки не имеют вовсе, и трактовать их как `none`
   * значило бы задним числом объявить, что упаковка заказа к ним не относится.
   */
  const ownSize = sizeOf(item);
  const orderSize = sizeOf(order);
  const size = ownSize ?? orderSize;
  const sizeInherited = ownSize === null;
  if (own && own !== 'inherit') {
    return {
      type: own as PackagingType,
      note: item?.packaging_note?.trim() || null,
      width_mm: size?.width_mm ?? null,
      height_mm: size?.height_mm ?? null,
      sizeInherited,
      inherited: false,
    };
  }
  return {
    type: (order?.packaging as PackagingType) || 'none',
    note: order?.packaging_note?.trim() || null,
    width_mm: size?.width_mm ?? null,
    height_mm: size?.height_mm ?? null,
    sizeInherited,
    inherited: true,
  };
}

/** Есть ли что показывать: «без упаковки» без комментария — не информация */
export function hasPackaging(p: ItemPackaging): boolean {
  return p.type !== 'none' || Boolean(p.note);
}

/**
 * Подпись упаковки одной строкой — для чипа в карточке, задания цеха и печатной
 * формы. Одна формулировка на все три места: их уже было три разных.
 */
export function packagingLabel(p: ItemPackaging): string {
  const base = PACKAGING_LABELS[p.type] ?? p.type;
  /**
   * Размер приписывается к подписи, а не показывается отдельным полем:
   * цех читает «БОПП-пакет 250×300 мм» одной строкой, и разнесённые части
   * пришлось бы собирать глазами в трёх местах (чип карточки, задание,
   * печатная форма).
   */
  const size = p.width_mm && p.height_mm ? `${p.width_mm}×${p.height_mm} мм` : '';
  const head = size && p.type !== 'none' ? `${base} ${size}` : base;
  return p.note ? `${head}: ${p.note}` : head;
}

/**
 * Стикеры остаются НА ЗАКАЗЕ. Заказчик просил разделить по изделиям упаковку,
 * про стикеры такого требования нет, а расщеплять поле «на всякий случай»
 * значит заводить ещё одну пару «своё/общее» без единого сценария.
 * Функция здесь ради того, чтобы подпись собиралась в одном месте с упаковкой.
 */
export function stickersLabel(
  stickers: StickersType | null | undefined,
  note: string | null | undefined,
): string | null {
  if (!stickers || stickers === 'none') return null;
  const base = STICKERS_LABELS[stickers] ?? stickers;
  const trimmed = note?.trim();
  return trimmed ? `${base} — ${trimmed}` : base;
}
