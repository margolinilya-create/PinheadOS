/**
 * Строгий разбор раскладки нанесения (`SalesPrint.layout`) — без zod
 * (веха 5а, задача 6б; проверка безопасности H1).
 *
 * Правила те же, что были у схемы `zod/mini` задачи 3: конечные числа
 * в границах (`limits.ts`), перечни, id по регулярке, имя файла ≤ 255,
 * целые там, где целые; лишние ключи отбрасываются — наружу уходит НОВЫЙ
 * объект только с известными полями. Всё, что не по форме, — `null`
 * («не размещено»: строка нанесения остаётся).
 *
 * Почему руками: zod — 6,8 кБ gzip в чанке холста (потолок 100 кБ из спеки,
 * README модуля), а раскладку читают и холст, и оболочка Order (признак
 * «на холсте» у строки нанесения и маркер вкладки «Дизайн»): zod не должен
 * попасть ни туда, ни туда (Review Focus 5). Один разбор на всех — строка
 * на «Изделии» и холст не расходятся во мнении, что размещено.
 */
import type { AssetMeta, PrintLayoutV1 } from '../types';
import { AREA_ID_RE, FLAT_ID_RE, MAX_COORD_MM, MAX_FLAT_VERSION, MAX_PX_SIDE, MAX_SOURCE_FILE_LEN } from '../limits';

const MAX_ROTATION_DEG = 360;
const MAX_DPI = 10000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number => num(v, lo, hi) && Number.isSafeInteger(v);
const coord = (v: unknown): v is number => num(v, -MAX_COORD_MM, MAX_COORD_MM);
const sizeMm = (v: unknown): v is number => num(v, Number.MIN_VALUE, MAX_COORD_MM);

function parseAsset(a: unknown): AssetMeta | null {
  if (!isObj(a)) return null;
  if (a.type !== 'svg' && a.type !== 'png') return null;
  if (typeof a.source_file !== 'string' || a.source_file.length > MAX_SOURCE_FILE_LEN) return null;
  if (!sizeMm(a.intrinsic_w_mm) || !sizeMm(a.intrinsic_h_mm)) return null;
  if (typeof a.size_estimated !== 'boolean' || typeof a.has_preview !== 'boolean') return null;
  const out: AssetMeta = {
    type: a.type,
    source_file: a.source_file,
    intrinsic_w_mm: a.intrinsic_w_mm,
    intrinsic_h_mm: a.intrinsic_h_mm,
    size_estimated: a.size_estimated,
    has_preview: a.has_preview,
  };
  for (const k of ['px_w', 'px_h'] as const) {
    if (a[k] === undefined) continue;
    if (!int(a[k], 1, MAX_PX_SIDE)) return null;
    out[k] = a[k];
  }
  if (a.dpi !== undefined) {
    if (!num(a.dpi, Number.MIN_VALUE, MAX_DPI)) return null;
    out.dpi = a.dpi;
  }
  return out;
}

/** Строгий терпимый разбор: всё, что не по форме, — `null` («не размещено») */
export function parseLayout(raw: unknown): PrintLayoutV1 | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  if (typeof raw.flat_id !== 'string' || !FLAT_ID_RE.test(raw.flat_id)) return null;
  if (!int(raw.flat_version, 1, MAX_FLAT_VERSION)) return null;
  if (raw.view !== 'front' && raw.view !== 'back') return null;
  if (typeof raw.area_id !== 'string' || !AREA_ID_RE.test(raw.area_id)) return null;
  if (!coord(raw.x_mm) || !coord(raw.y_mm)) return null;
  if (!num(raw.rotation_deg, -MAX_ROTATION_DEG, MAX_ROTATION_DEG)) return null;
  if (typeof raw.flip_h !== 'boolean' || typeof raw.flip_v !== 'boolean') return null;
  const asset = parseAsset(raw.asset);
  if (!asset) return null;
  return {
    v: 1,
    flat_id: raw.flat_id,
    flat_version: raw.flat_version,
    view: raw.view,
    area_id: raw.area_id,
    x_mm: raw.x_mm,
    y_mm: raw.y_mm,
    rotation_deg: raw.rotation_deg,
    flip_h: raw.flip_h,
    flip_v: raw.flip_v,
    asset,
  };
}

/** Нанесение стоит на холсте: раскладка по форме и на флэте позиции (`flatId`; пусто — любой) */
export function hasPlacedLayout(raw: unknown, flatId = ''): boolean {
  const layout = parseLayout(raw);
  return !!layout && (!flatId || layout.flat_id === flatId);
}

/** Сколько нанесений заказа не стоит на холсте (маркер вкладки «Дизайн») */
export function unplacedCount(items: { flat_id: string; prints: { layout: unknown }[] }[]): number {
  return items.reduce((n, it) => n + it.prints.filter((p) => !hasPlacedLayout(p.layout, it.flat_id)).length, 0);
}
