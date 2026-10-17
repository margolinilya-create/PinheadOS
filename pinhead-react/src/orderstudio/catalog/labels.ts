/**
 * Бирки заказа v4 по библиотеке `app_config.labelLibrary` (веха 4, задача 4).
 *
 * Здесь всё, что строке бирки (`LabelRow`), цене (`salesLabelPrice`) и редактору
 * (`admin/tabs/LabelsTab`) нужно знать о библиотеке:
 *   · `variant_id` позиции — `вариант[:материал]`, как и до библиотеки: id
 *     вариантов сида = прежние (`standard`, `my-logo`, `no-logo`, `custom`,
 *     `send-own`), поэтому старые заказы читаются без переноса;
 *   · цена — вариант + надбавка материала (только у варианта `withMaterial`);
 *     вида или варианта в библиотеке нет — `null`, и цена берётся прежним
 *     расчётом (`salesLabelPrice` без библиотеки);
 *   · снятое с продажи (`active: false`) в выбор не предлагается, но если оно
 *     уже стоит в бирке — показывается как есть с пометкой «снят с продажи»
 *     и не стирается; значение, которого в библиотеке нет вовсе, — с пометкой
 *     «нет в справочнике»;
 *   · `attach_scheme` позиции — id схемы библиотеки (прежний свободный текст
 *     показывается как есть, с пометкой «нет в справочнике»).
 */
import type { AttachScheme, LabelKind, LabelLibrary, LabelMaterial, LabelVariant } from './types';

/** Пометка снятого значения, которое уже стоит в бирке */
export const RETIRED_MARK = 'снят с продажи';
/** Пометка значения, которого в библиотеке нет (удалено руками, старый текст) */
export const UNKNOWN_MARK = 'нет в справочнике';

/** Вариант по умолчанию — как в визарде и в прежнем `LabelRow` */
const DEFAULT_VARIANT = 'standard';

export interface LabelChoice {
  /** `variant_id` бирки: вариант и материал */
  variant: string;
  material: string;
}

/** `variant_id` → вариант и материал (`custom:canvas` → custom + canvas) */
export function parseLabelVariant(variantId: string | null | undefined): LabelChoice {
  const [variant = '', material = ''] = String(variantId || '').split(':');
  return { variant, material };
}

/** Вариант и материал → `variant_id` (без материала — только вариант) */
export function joinLabelVariant(variant: string, material?: string): string {
  return [variant, material].filter(Boolean).join(':');
}

export function findLabelKind(lib: LabelLibrary | null | undefined, type: string): LabelKind | undefined {
  return lib?.kinds?.find((k) => k.type === type);
}

/**
 * Вариант, который строка показывает: выбранный, иначе `standard`, иначе
 * первый действующий. У вида без вариантов — пусто.
 */
export function shownVariantId(kind: LabelKind | undefined, variant: string): string {
  if (variant) return variant;
  if (!kind || kind.variants.length === 0) return '';
  if (kind.variants.some((v) => v.id === DEFAULT_VARIANT)) return DEFAULT_VARIANT;
  return (kind.variants.find((v) => v.active) ?? kind.variants[0]).id;
}

/** Нужен ли выбор материала у варианта */
export function variantTakesMaterial(kind: LabelKind | undefined, variantId: string): boolean {
  const v = kind?.variants.find((x) => x.id === variantId);
  return !!v && v.withMaterial && (kind?.materials.length ?? 0) > 0;
}

/**
 * Материал, который строка показывает, когда он не выбран: тот, что не меняет
 * цену (надбавка 0, как «Тканая» прежде), иначе пусто — «не выбран».
 */
export function shownMaterialKey(kind: LabelKind | undefined, material: string): string {
  if (material) return material;
  return kind?.materials.find((m) => m.active && m.priceDelta === 0)?.key ?? '';
}

/**
 * Цена бирки за штуку по библиотеке. `null` — библиотека этого не знает
 * (нет библиотеки, вида или варианта): тогда считает прежний расчёт.
 * Вид без вариантов в библиотеке — 0 ₽, как и прежде.
 */
export function libraryLabelPrice(
  lib: LabelLibrary | null | undefined,
  label: { label_type: string; variant_id: string },
): number | null {
  const kind = findLabelKind(lib, label.label_type);
  if (!kind) return null;
  if (kind.variants.length === 0) return 0;
  const { variant, material } = parseLabelVariant(label.variant_id);
  const v = kind.variants.find((x) => x.id === shownVariantId(kind, variant));
  if (!v) return null;
  const m = v.withMaterial ? kind.materials.find((x) => x.key === material) : undefined;
  // Надбавка материала бывает минусом (полиэстер −5 ₽), но цена бирки — не ниже нуля:
  // вариант 10 ₽ с материалом −20 ₽ иначе дал бы −10 ₽ за штуку в цене позиции.
  return Math.max(0, v.price + (m ? m.priceDelta : 0));
}

export interface LabelOption {
  value: string;
  label: string;
  /** Снято с продажи или нет в библиотеке — показано, потому что уже выбрано */
  marked: boolean;
}

interface Entry { id: string; name: string; active: boolean }

/**
 * Пункты выбора: действующие + текущее значение, даже если оно снято
 * (с пометкой) или его нет в библиотеке (с пометкой). Текущее не теряется.
 */
function optionsOf(entries: Entry[], current: string): LabelOption[] {
  const out: LabelOption[] = entries
    .filter((e) => e.active || e.id === current)
    .map((e) => ({
      value: e.id,
      label: e.active ? e.name : `${e.name} (${RETIRED_MARK})`,
      marked: !e.active,
    }));
  if (current && !entries.some((e) => e.id === current)) {
    out.push({ value: current, label: `${current} (${UNKNOWN_MARK})`, marked: true });
  }
  return out;
}

export function labelKindOptions(lib: LabelLibrary | null | undefined, current: string): LabelOption[] {
  const kinds = (lib?.kinds ?? []).map((k) => ({ id: k.type, name: k.name, active: k.active }));
  return optionsOf(kinds, current);
}

export function labelVariantOptions(kind: LabelKind | undefined, current: string): LabelOption[] {
  return optionsOf((kind?.variants ?? []).map((v: LabelVariant) => ({ id: v.id, name: v.name, active: v.active })), current);
}

export function labelMaterialOptions(kind: LabelKind | undefined, current: string): LabelOption[] {
  return optionsOf((kind?.materials ?? []).map((m: LabelMaterial) => ({ id: m.key, name: m.name, active: m.active })), current);
}

export function attachSchemeOptions(lib: LabelLibrary | null | undefined, current: string): LabelOption[] {
  return optionsOf((lib?.schemes ?? []).map((s: AttachScheme) => ({ id: s.id, name: s.name, active: s.active })), current);
}

// ── редактор библиотеки ───────────────────────────────────────────────────

/**
 * Новый id внутри списка: `<префикс>-<n>`, ASCII, не совпадает с имеющимися.
 * Id пишется в позицию (`variant_id`, `attach_scheme`) — после записи не меняется.
 */
export function nextLibraryId(prefix: string, taken: string[]): string {
  const set = new Set(taken);
  let n = taken.length + 1;
  while (set.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** Надбавка материала: пусто — 0, запятая — десятичная, минус разрешён; иначе — ещё набирают */
export function parseDelta(text: string): number | undefined {
  const t = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-') return t === '' ? 0 : undefined;
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) return undefined;
  return Number(t);
}

/** Цена варианта: пусто — 0, не меньше нуля (так же проверяет сервер) */
export function parsePrice(text: string): number | undefined {
  const d = parseDelta(text);
  return d === undefined || d < 0 ? undefined : d;
}

export const formatNumber = (v: number | null | undefined): string => (v == null ? '' : String(v).replace('.', ','));

/**
 * Что мешает сохранить библиотеку (пусто — можно). Сервер проверяет то же
 * (`catalog_put`), здесь — чтобы назвать ошибку по-человечески до записи.
 */
export function labelLibraryProblems(lib: LabelLibrary): string[] {
  const out: string[] = [];
  for (const k of lib.kinds) {
    k.variants.forEach((v, i) => {
      if (!v.name.trim()) out.push(`${k.name}: у варианта ${i + 1} нет названия`);
      if (!Number.isFinite(v.price) || v.price < 0) out.push(`${k.name}: цена варианта «${v.name || i + 1}» меньше нуля`);
    });
    k.materials.forEach((m, i) => {
      if (!m.name.trim()) out.push(`${k.name}: у материала ${i + 1} нет названия`);
      if (!Number.isFinite(m.priceDelta)) out.push(`${k.name}: надбавка материала «${m.name || i + 1}» не число`);
    });
  }
  lib.schemes.forEach((s, i) => {
    if (!s.name.trim()) out.push(`У схемы ${i + 1} нет названия`);
  });
  return out;
}

// ── правка библиотеки (неизменяемо: каждая функция отдаёт новую библиотеку) ──

function mapKind(lib: LabelLibrary, type: string, fn: (k: LabelKind) => LabelKind): LabelLibrary {
  return { ...lib, kinds: lib.kinds.map((k) => (k.type === type ? fn(k) : k)) };
}

/**
 * Вид: правится только «в продаже». Код и имя вида связаны со справочником
 * ERP (`LABEL_TYPE_TO_ERP`, мост запуска) — новых видов редактор не заводит.
 */
export function patchKind(lib: LabelLibrary, type: string, patch: Partial<Pick<LabelKind, 'active'>>): LabelLibrary {
  return mapKind(lib, type, (k) => ({ ...k, ...patch }));
}

export function patchVariant(
  lib: LabelLibrary, type: string, id: string, patch: Partial<Omit<LabelVariant, 'id'>>,
): LabelLibrary {
  return mapKind(lib, type, (k) => ({ ...k, variants: k.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
}

export function patchMaterial(
  lib: LabelLibrary, type: string, key: string, patch: Partial<Omit<LabelMaterial, 'key'>>,
): LabelLibrary {
  return mapKind(lib, type, (k) => ({ ...k, materials: k.materials.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));
}

export function patchScheme(lib: LabelLibrary, id: string, patch: Partial<Omit<AttachScheme, 'id'>>): LabelLibrary {
  return { ...lib, schemes: lib.schemes.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Новый вариант вида: без названия, 0 ₽, без материала, в продаже */
export function addVariant(lib: LabelLibrary, type: string): LabelLibrary {
  return mapKind(lib, type, (k) => ({
    ...k,
    variants: [...k.variants, {
      id: nextLibraryId('v', k.variants.map((v) => v.id)), name: '', price: 0, withMaterial: false, active: true,
    }],
  }));
}

/** Новый материал вида: без названия, надбавка 0, в продаже */
export function addMaterial(lib: LabelLibrary, type: string): LabelLibrary {
  return mapKind(lib, type, (k) => ({
    ...k,
    materials: [...k.materials, {
      key: nextLibraryId('m', k.materials.map((m) => m.key)), name: '', priceDelta: 0, active: true,
    }],
  }));
}

/** Новая схема притачивания: без названия, в продаже */
export function addScheme(lib: LabelLibrary): LabelLibrary {
  return {
    ...lib,
    schemes: [...lib.schemes, { id: nextLibraryId('s', lib.schemes.map((s) => s.id)), name: '', active: true }],
  };
}
