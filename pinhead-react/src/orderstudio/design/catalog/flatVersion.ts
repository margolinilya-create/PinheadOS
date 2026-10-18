/**
 * Версии флэта (веха 5б, решения контроллера К1, К6, К7, К15) — чистые функции
 * без React и сети: их читают холст рабочего места, превью, PDF и редактор флэта.
 *
 * - **Правило версии (К6).** Поля флэта, вида, якорей и зоны поделены на
 *   геометрию и метаданные явными множествами `GEOMETRY_KEYS` / `META_KEYS`;
 *   сторож классификации сверяет их с ключами zod-схем. Изменение геометрии —
 *   выпуск новой версии, метаданных — сохранение без версии.
 * - **История (К1).** При выпуске версии N+1 виды версии N дописываются
 *   в `history` как есть; записи не меняются и не удаляются (`historyPreserved`).
 * - **Флэт на версии V (`flatAtVersion`).** Поле `version` результата — V:
 *   иначе размещение на позиции v1 записало бы `flat_version` текущей с
 *   координатами v1. Геометрия — из истории V, метаданные зоны — из текущей
 *   версии по виду и `area.id` (решения 11 и 20).
 * - **Склейка справочника (К7)** — `mergeFlatIntoRaw`: прочие записи сырыми,
 *   как есть (битые и поля будущих клиентов тоже); размер — в байтах UTF-8,
 *   как считает сервер (`octet_length`).
 */
import type { SalesPrint } from '../../model/types';
import type { FlatView, FlatViewKind, GarmentFlat, PrintArea } from '../types';
import { flatSvgPathOf } from '../limits';
import { parseLayout } from '../model/layoutMark';

type KeySet = { flat: readonly string[]; view: readonly string[]; anchors: readonly string[]; area: readonly string[] };

/** Геометрия: меняет силуэт — сохраняется новой версией (К6) */
export const GEOMETRY_KEYS: KeySet = {
  flat: ['id', 'version', 'views', 'history'],
  view: ['kind', 'svg_path', 'scale_mm_per_unit', 'anchors', 'size_anchors', 'grade_rule', 'print_areas'],
  anchors: ['neckline_point', 'center_axis_x', 'sleeve_bottom_y', 'sleeve_center_x', 'axes'],
  area: ['id', 'zone_id', 'polygon_mm', 'safe_inset_mm'],
};

/** Метаданные: сохраняются без новой версии; метаданные зоны видны и старым версиям */
export const META_KEYS: KeySet = {
  flat: ['name', 'garment_type', 'typical', 'active', 'sku_codes', 'categories', 'fits', 'base_size', 'sizes'],
  view: [],
  anchors: [],
  area: ['name', 'tz_row', 'methods', 'default_method', 'max_print_mm', 'min_print_mm'],
};

type Obj = Record<string, unknown>;

/** Ключи `keys` объекта, кроме `undefined` (проекция геометрии или метаданных) */
export function pickKeys(o: object, keys: readonly string[]): Obj {
  const src = o as Obj;
  const out: Obj = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function anchorsGeometry(a: object): Obj {
  return pickKeys(a, GEOMETRY_KEYS.anchors);
}

function viewGeometry(v: FlatView): Obj {
  const g = pickKeys(v, GEOMETRY_KEYS.view);
  if (g.anchors) g.anchors = anchorsGeometry(v.anchors);
  if (v.size_anchors) {
    g.size_anchors = Object.fromEntries(Object.entries(v.size_anchors).map(([s, a]) => [s, anchorsGeometry(a)]));
  }
  if (g.print_areas) g.print_areas = v.print_areas.map((a) => pickKeys(a, GEOMETRY_KEYS.area));
  return g;
}

/** Проекция геометрии флэта (К6): то, изменение чего выпускает новую версию */
export function geometryOf(flat: GarmentFlat): unknown {
  const g = pickKeys(flat, GEOMETRY_KEYS.flat);
  if (g.views) g.views = flat.views.map(viewGeometry);
  return g;
}

/** JSON с упорядоченными ключами: сравнение не зависит от порядка полей в записи */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Obj;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Изменилась ли геометрия против базы; новый флэт и новый файл вида — всегда да */
export function geometryChanged(base: GarmentFlat | null, next: GarmentFlat, newFileKinds: readonly FlatViewKind[]): boolean {
  if (!base || newFileKinds.length > 0) return true;
  return stableJson(geometryOf(base)) !== stableJson(geometryOf(next));
}

/** Версии, уже занятые флэтом: текущая и записи истории */
function knownVersions(flat: GarmentFlat): number[] {
  return [flat.version, ...(flat.history ?? []).map((h) => h.version)];
}

/** Следующая версия: max(текущая, история) + 1 + `skip`; новый флэт — 1 + `skip` */
export function nextVersion(base: GarmentFlat | null, skip = 0): number {
  return (base ? Math.max(...knownVersions(base)) : 0) + 1 + skip;
}

/**
 * Выпуск версии `version`: пути всех видов — `v<version>`, виды базы — в историю
 * как есть. Новый флэт — без истории. Версия не больше базовой — не выпуск:
 * правка остаётся на версии базы с её историей
 */
export function releaseFlat(base: GarmentFlat | null, next: GarmentFlat, version: number): GarmentFlat {
  const { history: _drop, ...rest } = next;
  if (base && !(version > base.version)) {
    return base.history ? { ...rest, version: base.version, history: base.history } : { ...rest, version: base.version };
  }
  const views = next.views.map((v) => ({ ...v, svg_path: flatSvgPathOf(next.id, version, v.kind) }));
  if (!base) return { ...rest, version, views };
  return { ...rest, version, views, history: [...(base.history ?? []), { version: base.version, views: base.views }] };
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Справочник для записи: правленая запись — разобранной, прочие — те же ссылки
 * (битые и поля будущих клиентов не теряются). Строки нет (`null`) — справочник
 * из одной записи; не-null неверной формы — `'bad_shape'` (писать нельзя)
 */
export function mergeFlatIntoRaw(rawBase: unknown, flat: GarmentFlat): { version: 1; flats: unknown[] } | 'bad_shape' {
  if (rawBase === null || rawBase === undefined) return { version: 1, flats: [flat] };
  if (!isObj(rawBase) || rawBase.version !== 1 || !Array.isArray(rawBase.flats)) return 'bad_shape';
  const items = rawBase.flats as unknown[];
  const at = items.findIndex((x) => isObj(x) && x.id === flat.id);
  const flats = at < 0 ? [...items, flat] : items.map((x, i) => (i === at ? flat : x));
  return { version: 1, flats };
}

/** Размер значения в байтах UTF-8 — как `octet_length` у сервера (кириллица — 2 байта) */
export function catalogBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * История не потеряна и не правлена: каждая запись базы — в `next` без изменений,
 * а при выпуске (версия выросла) виды базы дописаны записью её версии
 */
export function historyPreserved(base: GarmentFlat | null, next: GarmentFlat): boolean {
  if (!base) return true;
  const entries = new Map((next.history ?? []).map((h) => [h.version, stableJson(h)]));
  const kept = (base.history ?? []).every((h) => entries.get(h.version) === stableJson(h));
  if (!kept) return false;
  if (next.version <= base.version) return true;
  return entries.get(base.version) === stableJson({ version: base.version, views: base.views });
}

/** Наложить метаданные зоны текущей версии (по виду и `area.id`) на зону старой версии */
function overlayAreaMeta(area: PrintArea, current: PrintArea | undefined): PrintArea {
  if (!current) return area;
  const out: Obj = { ...area };
  for (const k of META_KEYS.area) delete out[k];
  return { ...out, ...pickKeys(current, META_KEYS.area) } as unknown as PrintArea;
}

/**
 * Флэт на версии V: `version` = V, виды — из истории V, история убрана;
 * метаданные зоны — текущие. V = текущая — флэт как есть; неизвестная — `null`
 */
export function flatAtVersion(flat: GarmentFlat, version: number): GarmentFlat | null {
  if (version === flat.version) return flat;
  const entry = (flat.history ?? []).find((h) => h.version === version);
  if (!entry) return null;
  const views = entry.views.map((v) => {
    const cur = flat.views.find((c) => c.kind === v.kind);
    return { ...v, print_areas: v.print_areas.map((a) => overlayAreaMeta(a, cur?.print_areas.find((c) => c.id === a.id))) };
  });
  const { history: _drop, ...rest } = flat;
  return { ...rest, version, views };
}

export interface ItemFlatVersion {
  /** Версия, по которой рисовать и ставить новые размещения позиции */
  version: number;
  /** У позиции раскладки разных версий */
  mixed: boolean;
  /** Версия раскладок есть у флэта (текущая или в истории) */
  known: boolean;
}

/**
 * Версия раскладок позиции на этом флэте (К15): одна известная — она; нет
 * раскладок — текущая; несколько или неизвестная — текущая с пометкой
 */
export function itemFlatVersion(prints: readonly SalesPrint[], flat: GarmentFlat): ItemFlatVersion {
  const versions = new Set<number>();
  for (const p of prints) {
    const l = parseLayout(p.layout);
    if (l && l.flat_id === flat.id) versions.add(l.flat_version);
  }
  const has = new Set(knownVersions(flat));
  const known = [...versions].every((v) => has.has(v));
  if (versions.size === 0) return { version: flat.version, mixed: false, known: true };
  if (versions.size > 1) return { version: flat.version, mixed: true, known };
  const [only] = versions;
  return known ? { version: only, mixed: false, known: true } : { version: flat.version, mixed: false, known: false };
}
