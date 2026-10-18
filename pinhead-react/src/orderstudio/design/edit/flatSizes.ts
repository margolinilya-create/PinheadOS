/**
 * Размеры флэта — метаданные, без новой версии (веха 5б, К13). Перенос DM
 * `addSize`/`removeSize` с исправлением дефектов 3 и 4:
 * - (3) удаление размера чистит его ключ в `size_anchors` всех видов —
 *   иначе схема отказала бы («размера нет в размерах»);
 * - (4) список сортируется по `sizeOrder` (как размерная сетка заказа),
 *   а не по порядку ввода.
 * Базовый размер удалить нельзя. Чистые функции: отказ — тот же объект.
 */
import { sizeOrder } from '../../../store/slices/helpers';
import type { GarmentFlat } from '../types';

const MAX_SIZES = 64;
const MAX_SIZE_LEN = 64;

function sorted(sizes: string[]): string[] {
  return sizes
    .map((s, i) => ({ s, i }))
    .sort((a, b) => sizeOrder(a.s) - sizeOrder(b.s) || a.i - b.i)
    .map((x) => x.s);
}

/** Добавить размер (обрезка пробелов, без повторов, по порядку размеров) */
export function addSize(flat: GarmentFlat, size: string): GarmentFlat {
  const s = size.trim();
  if (!s || s.length > MAX_SIZE_LEN || flat.sizes.includes(s) || flat.sizes.length >= MAX_SIZES) return flat;
  return { ...flat, sizes: sorted([...flat.sizes, s]) };
}

/** Удалить размер и его якоря во всех видах; базовый — отказ */
export function removeSize(flat: GarmentFlat, size: string): GarmentFlat {
  if (size === flat.base_size || !flat.sizes.includes(size)) return flat;
  const views = flat.views.map((v) => {
    if (!v.size_anchors || !(size in v.size_anchors)) return v;
    const { [size]: _drop, ...rest } = v.size_anchors;
    if (Object.keys(rest).length > 0) return { ...v, size_anchors: rest };
    const { size_anchors: _none, ...view } = v;
    return view;
  });
  return { ...flat, sizes: flat.sizes.filter((s) => s !== size), views };
}

/** Базовый размер — только из списка размеров (пустой список — любой непустой) */
export function setBaseSize(flat: GarmentFlat, size: string): GarmentFlat {
  const s = size.trim();
  if (!s || s === flat.base_size) return flat;
  if (flat.sizes.length > 0 && !flat.sizes.includes(s)) return flat;
  return { ...flat, base_size: s };
}
