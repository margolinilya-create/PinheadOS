/**
 * Проверка справочника флэтов `app_config.garmentFlats` (zod 4, `zod/mini` —
 * решение задачи 0: 6,5 кБ против 19 кБ полного zod в чанке холста).
 *
 * Перенос DM `lib/catalog/schema.ts` в нашу форму (`types.ts`):
 * - инварианты DM — «`default_method` ∈ `methods`», якоря по виду (у одежды
 *   перед/спина — горловина и ось; у аксессуара горловины может не быть),
 *   невырожденная зона и разумный safe-inset, `base_size` ∈ `sizes`;
 * - границы — как у серверной `catalog_value_check` (миграция H; L2): версия
 *   1…9999, масштаб ≤ 10, |коорд.| ≤ 5000, ≤ 256 точек, имя ≤ 200;
 * - **путь SVG сверяется с формулой** `flats/<id>/v<версия>/<вид>.svg` (M5):
 *   admin может писать `app_config` мимо RPC, клиент справочнику не доверяет.
 *
 * Битый справочник не роняет экран: `parseFlatsCatalog` отбрасывает битые
 * флэты и возвращает список замечаний (`issues`) по-русски.
 *
 * Веха 5б (задача 1): история версий `history[]` (К1) — у записи свой путь
 * `flats/<id>/v<версия записи>/<вид>.svg`, версии уникальны и меньше текущей;
 * `tz_row` — код из перечня `catalog/tzRows` (К8); `zone_id` — `ZONE_ID_RE`;
 * код модели — не больше чем у одного активного флэта (уровень справочника).
 * Та же форма — у ветки `garmentFlats` в `catalog_value_check` миграции I.
 */
import * as z from 'zod/mini';
import { SALES_PRINT_METHODS } from '../../model/types';
import { FLAT_VIEW_KINDS, GARMENT_TYPES, type GarmentFlat, type GarmentFlatsCatalog } from '../types';
import { isAccessoryType } from './categoryMap';
import { TZ_ROW_CODES, ZONE_ID_RE } from '../../catalog/tzRows';
import {
  AREA_ID_RE, FLAT_ID_RE, MAX_COORD_MM, MAX_FLAT_VERSION, MAX_NAME_LEN, MAX_PATTERN_COUNT, MAX_PATTERN_POINTS,
  MAX_POLYGON_POINTS, MAX_SCALE_MM_PER_UNIT, flatSvgPathOf,
} from '../limits';

const coord = z.number().check(z.gte(-MAX_COORD_MM), z.lte(MAX_COORD_MM));
const positiveMm = z.number().check(z.gt(0), z.lte(MAX_COORD_MM));
const name = z.string().check(z.minLength(1), z.maxLength(MAX_NAME_LEN));
const shortStr = z.string().check(z.maxLength(64));
const strList = z.array(shortStr).check(z.maxLength(200));
const method = z.enum(SALES_PRINT_METHODS);
const point = z.object({ x: coord, y: coord });
const box = z.object({ width: positiveMm, height: positiveMm });

export const anchorsSchema = z.object({
  neckline_point: z.optional(point),
  center_axis_x: z.optional(coord),
  sleeve_bottom_y: z.optional(coord),
  sleeve_center_x: z.optional(coord),
  axes: z.optional(z.array(z.object({ id: z.string().check(z.regex(AREA_ID_RE)), name, x: coord })).check(z.maxLength(32))),
});
type AnchorsIn = z.infer<typeof anchorsSchema>;

const delta = z.object({ dx: z.optional(coord), dy: z.optional(coord) });
const gradeRuleSchema = z.object({
  neckline: z.optional(delta),
  center_axis_dx: z.optional(coord),
  sleeve_bottom_dy: z.optional(coord),
  sleeve_center_dx: z.optional(coord),
});

export const printAreaSchema = z.object({
  id: z.string().check(z.regex(AREA_ID_RE)),
  name,
  zone_id: z.nullable(z.string().check(z.regex(ZONE_ID_RE))),
  tz_row: z.optional(z.enum(TZ_ROW_CODES)),
  polygon_mm: z.array(z.tuple([coord, coord])).check(z.minLength(3), z.maxLength(MAX_POLYGON_POINTS)),
  safe_inset_mm: z.number().check(z.gte(0), z.lte(MAX_COORD_MM)),
  default_method: z.optional(method),
  methods: z.optional(z.array(method).check(z.maxLength(SALES_PRINT_METHODS.length))),
  max_print_mm: z.optional(box),
  min_print_mm: z.optional(box),
}).check(z.superRefine((a, ctx) => {
  if (a.default_method && a.methods?.length && !a.methods.includes(a.default_method)) {
    ctx.addIssue({ code: 'custom', path: ['default_method'], message: `техника по умолчанию «${a.default_method}» не входит в допустимые зоны «${a.id}»` });
  }
  const xs = a.polygon_mm.map((p) => p[0]);
  const ys = a.polygon_mm.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (!(w > 0) || !(h > 0)) {
    ctx.addIssue({ code: 'custom', path: ['polygon_mm'], message: 'зона вырождена: ширина и высота должны быть больше 0' });
  } else if (!(a.safe_inset_mm * 2 < Math.min(w, h))) {
    ctx.addIssue({ code: 'custom', path: ['safe_inset_mm'], message: 'безопасный отступ ×2 должен быть меньше меньшей стороны зоны' });
  }
}));

export const viewSchema = z.object({
  kind: z.enum(FLAT_VIEW_KINDS),
  svg_path: z.string().check(z.maxLength(MAX_NAME_LEN)),
  scale_mm_per_unit: z.number().check(z.gt(0), z.lte(MAX_SCALE_MM_PER_UNIT)),
  anchors: anchorsSchema,
  size_anchors: z.optional(z.record(shortStr, anchorsSchema)),
  grade_rule: z.optional(gradeRuleSchema),
  print_areas: z.array(printAreaSchema).check(z.minLength(1), z.maxLength(32)),
  // Лекало детали (веха 5в, Э2б): без поля в схеме `z.object` отбросил бы его при чтении
  pattern: z.optional(z.object({
    contour_mm: z.array(z.tuple([coord, coord])).check(z.minLength(3), z.maxLength(MAX_PATTERN_POINTS)),
    count: z.int().check(z.gte(1), z.lte(MAX_PATTERN_COUNT)),
  })),
});

type Ctx = { addIssue: (i: { code: 'custom'; path: (string | number)[]; message: string }) => void };

/** Якоря согласуются с видом: рукав — низ и центр рукава; перед/спина — ось и горловина (кроме аксессуара) */
function checkAnchors(a: AnchorsIn, kind: string, accessory: boolean, path: (string | number)[], ctx: Ctx): void {
  const miss = (key: string, message: string) => ctx.addIssue({ code: 'custom', path: [...path, key], message });
  if (kind === 'sleeve_left' || kind === 'sleeve_right') {
    if (a.sleeve_bottom_y === undefined) miss('sleeve_bottom_y', 'у рукава обязателен низ рукава');
    if (a.sleeve_center_x === undefined) miss('sleeve_center_x', 'у рукава обязателен центр рукава');
    return;
  }
  if (a.neckline_point === undefined && !accessory) miss('neckline_point', 'у переда и спины одежды обязательна горловина');
  if (a.center_axis_x === undefined) miss('center_axis_x', 'у переда и спины обязательна ось центра');
}

const historyEntrySchema = z.object({
  version: z.int().check(z.gte(1), z.lte(MAX_FLAT_VERSION)),
  views: z.array(viewSchema).check(z.minLength(1), z.maxLength(FLAT_VIEW_KINDS.length)),
});

type ViewIn = z.infer<typeof viewSchema>;

/**
 * Виды одной версии: вид не повторяется, путь — по формуле с этой версией (M5),
 * якоря по виду, зона не повторяется. `sizes` — размеры флэта; у истории `null`:
 * размеры — метаданные текущей версии и могли измениться
 */
function checkViews(
  views: ViewIn[], f: { id: string; garment_type: string }, version: number,
  sizes: Set<string> | null, path: (string | number)[], ctx: Ctx,
): void {
  const accessory = isAccessoryType(f.garment_type as GarmentFlat['garment_type']);
  const kinds = new Set<string>();
  views.forEach((v, vi) => {
    const at = [...path, vi];
    if (kinds.has(v.kind)) ctx.addIssue({ code: 'custom', path: [...at, 'kind'], message: `вид «${v.kind}» повторяется` });
    kinds.add(v.kind);
    const expected = flatSvgPathOf(f.id, version, v.kind);
    if (v.svg_path !== expected) {
      ctx.addIssue({ code: 'custom', path: [...at, 'svg_path'], message: `путь SVG должен быть «${expected}»` });
    }
    checkAnchors(v.anchors, v.kind, accessory, [...at, 'anchors'], ctx);
    for (const [size, a] of Object.entries(v.size_anchors ?? {})) {
      if (sizes && !sizes.has(size)) ctx.addIssue({ code: 'custom', path: [...at, 'size_anchors', size], message: `размера «${size}» нет в размерах` });
      checkAnchors(a, v.kind, accessory, [...at, 'size_anchors', size], ctx);
    }
    const ids = new Set<string>();
    v.print_areas.forEach((a, ai) => {
      if (ids.has(a.id)) ctx.addIssue({ code: 'custom', path: [...at, 'print_areas', ai, 'id'], message: `зона «${a.id}» повторяется` });
      ids.add(a.id);
    });
  });
}

export const flatSchema = z.object({
  id: z.string().check(z.regex(FLAT_ID_RE)),
  name,
  garment_type: z.enum(GARMENT_TYPES),
  typical: z.boolean(),
  active: z.boolean(),
  version: z.int().check(z.gte(1), z.lte(MAX_FLAT_VERSION)),
  sku_codes: strList,
  categories: strList,
  fits: strList,
  base_size: shortStr,
  sizes: z.array(shortStr).check(z.maxLength(64)),
  views: z.array(viewSchema).check(z.minLength(1), z.maxLength(FLAT_VIEW_KINDS.length)),
  history: z.optional(z.array(historyEntrySchema).check(z.maxLength(MAX_FLAT_VERSION))),
}).check(z.superRefine((f, ctx) => {
  const sizes = new Set(f.sizes);
  if (f.sizes.length > 0 && !sizes.has(f.base_size)) {
    ctx.addIssue({ code: 'custom', path: ['base_size'], message: `базового размера «${f.base_size}» нет в размерах` });
  }
  checkViews(f.views, f, f.version, sizes, ['views'], ctx);
  const versions = new Set<number>();
  (f.history ?? []).forEach((h, hi) => {
    const at = ['history', hi];
    if (versions.has(h.version)) ctx.addIssue({ code: 'custom', path: [...at, 'version'], message: `версия истории ${h.version} повторяется` });
    versions.add(h.version);
    if (!(h.version < f.version)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'version'], message: `версия истории ${h.version} должна быть меньше текущей ${f.version}` });
    }
    checkViews(h.views, f, h.version, null, [...at, 'views'], ctx);
  });
}));

const catalogShape = z.object({ version: z.literal(1), flats: z.array(z.unknown()).check(z.maxLength(1000)) });

const CODE_TEXT: Record<string, string> = {
  invalid_type: 'неверный тип',
  too_small: 'меньше допустимого',
  too_big: 'больше допустимого',
  invalid_format: 'неверный формат',
  invalid_value: 'недопустимое значение',
  invalid_union: 'недопустимое значение',
  invalid_key: 'недопустимый ключ',
  invalid_element: 'недопустимый элемент',
  unrecognized_keys: 'лишние поля',
  not_multiple_of: 'недопустимое значение',
};

function issueText(i: { code: string; path: PropertyKey[]; message: string }): string {
  const where = i.path.map(String).join('.');
  const what = i.code === 'custom' ? i.message : (CODE_TEXT[i.code] ?? 'ошибка');
  return where ? `${where}: ${what}` : what;
}

export interface FlatsParse {
  /** Справочник целиком корректен */
  ok: boolean;
  /** Корректные флэты (битые и дубли id отброшены) */
  catalog: GarmentFlatsCatalog;
  /** Замечания по-русски */
  issues: string[];
}

/** Терпимый разбор справочника: битый флэт отбрасывается, экран не падает */
export function parseFlatsCatalog(raw: unknown): FlatsParse {
  const shape = z.safeParse(catalogShape, raw);
  if (!shape.success) {
    return { ok: false, catalog: { version: 1, flats: [] }, issues: ['Справочник флэтов: неверная форма (нужны version = 1 и список flats)'] };
  }
  const flats: GarmentFlat[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  shape.data.flats.forEach((item, i) => {
    const r = z.safeParse(flatSchema, item);
    const label = (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
      ? String((item as { id: string }).id).slice(0, 64)
      : `№${i + 1}`;
    if (!r.success) {
      issues.push(...r.error.issues.map((x) => `Флэт «${label}»: ${issueText(x)}`));
      return;
    }
    if (seen.has(r.data.id)) {
      issues.push(`Флэт «${label}»: id повторяется`);
      return;
    }
    seen.add(r.data.id);
    flats.push(r.data as GarmentFlat);
  });
  issues.push(...catalogIssues(flats));
  return { ok: issues.length === 0, catalog: { version: 1, flats }, issues };
}

/**
 * Проверки уровня справочника (как у сервера, миграция I): код модели —
 * не больше чем у одного АКТИВНОГО флэта. Снятый флэт код не занимает.
 * Флэты не отбрасываются: какой из двух «лишний», решает администратор
 */
export function catalogIssues(flats: readonly GarmentFlat[]): string[] {
  const owner = new Map<string, string>();
  const issues: string[] = [];
  for (const f of flats) {
    if (!f.active) continue;
    for (const code of new Set(f.sku_codes)) {
      const first = owner.get(code);
      if (first) issues.push(`Флэт «${f.id}»: модель ${code} уже у флэта «${first}»`);
      else owner.set(code, f.id);
    }
  }
  return issues;
}

/** Замечание схемы по одному флэту: путь поля и текст по-русски */
export interface FlatSchemaIssue {
  path: (string | number)[];
  text: string;
}

/** Замечания схемы по одному флэту (редактор: адрес поля для «Перейти»); пусто — флэт корректен */
export function flatSchemaIssues(f: unknown): FlatSchemaIssue[] {
  const r = z.safeParse(flatSchema, f);
  if (r.success) return [];
  return r.error.issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number'),
    text: issueText(i),
  }));
}

/** Замечания схемы по одному флэту — тексты, как в `parseFlatsCatalog` */
export function flatIssues(f: unknown): string[] {
  return flatSchemaIssues(f).map((i) => i.text);
}
