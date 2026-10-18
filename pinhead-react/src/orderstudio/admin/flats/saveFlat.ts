/**
 * Сохранение флэта из редактора (веха 5б, задача 3; решения контроллера К2–К7).
 * Писатель, а не чистое ядро (К14): ходит в `api/garmentFlats` (бакет),
 * `catalogAdmin.putCatalog` (справочник) и `toast`. Чистые части — `releaseFlat`,
 * `mergeFlatIntoRaw`, `catalogBytes` — в `design/catalog/flatVersion.ts`.
 *
 * Порядок (справочник никогда не ссылается на отсутствующий или чужой файл):
 *   1. **Без сети, до загрузки файлов:** проверка флэта (`validateFlat`,
 *      `historyPreserved`), склейка справочника (`mergeFlatIntoRaw`: прочие
 *      записи — сырыми, теми же ссылками), проверка склеенного справочника, как
 *      у сервера (битая чужая запись — отказ с её id, запрос не шлётся), размер
 *      в байтах UTF-8.
 *   2. **Только метаданные** (геометрия не менялась, файлов нет) — версия
 *      прежняя, файлов не грузим.
 *      **Геометрия или новый флэт** — выпуск версии: стартовый номер =
 *      max(по справочнику и истории, занятые `v<N>` в бакете) + 1 (К3);
 *      каждый вид грузится по новому пути — новый файл из правки либо перенос
 *      прежнего свежим скачиванием (К2, без кэша холста: он помнит неудачу);
 *      «уже есть» с другим текстом — следующая версия, все виды заново,
 *      не больше `MAX_VERSION_ATTEMPTS` раз (гонка двух администраторов).
 *   3. Справочник — последним: `putCatalog` с базой от свежего чтения.
 *      Успех — сброс кэша справочника флэтов (`invalidateFlatsCatalog`).
 *
 * Сбой файла — справочник не пишется; повтор с тем же файлом принимается
 * как `'same'`. Отказ сервера 22023 — вид `invalid` с текстом сервера дословно.
 */
import { downloadFlatSvg, listFlatVersions, uploadFlatSvgOnce } from '../../api/garmentFlats';
import { putCatalog } from '../../api/catalogAdmin';
import { toast } from '../../../store/useToastStore';
import { sanitizeSvg } from '../../design/assets/sanitizeSvg';
import { flatIssues, parseFlatsCatalog } from '../../design/catalog/flatsSchema';
import {
  catalogBytes, geometryChanged, historyPreserved, mergeFlatIntoRaw, nextVersion, releaseFlat,
} from '../../design/catalog/flatVersion';
import { VIEW_LABELS } from '../../design/catalog/flatLabels';
import { invalidateFlatsCatalog } from '../../design/catalog/useFlatsCatalog';
import { validateFlat, CATALOG_MAX_BYTES } from '../../design/edit/validateFlat';
import type { ZoneLike } from '../../design/edit/flatAreas';
import { resolveFlat } from '../../design/export/resolveFlat';
import { MAX_FLAT_VERSION, flatSvgPathOf } from '../../design/limits';
import type { FlatViewKind, GarmentFlat } from '../../design/types';

/** Попыток выпуска при «уже есть, другой текст» — только на гонку двух администраторов (К3) */
export const MAX_VERSION_ATTEMPTS = 5;

export const MSG_BAD_SHAPE = 'Флэт не сохранён: справочник флэтов в базе неверной формы (нужны version = 1 и список flats)';
export const MSG_TOO_BIG = 'Справочник флэтов превысит 1 МБ — снимите лишние флэты или сообщите администратору: история версий растёт с каждым выпуском';
export const MSG_HISTORY = 'История версий флэта изменилась — загрузите свежую версию';
export const MSG_LIST_FAILED = 'Не удалось узнать занятые версии флэта — проверьте связь и нажмите кнопку сохранения ещё раз. Справочник не изменён';
export const MSG_VERSIONS_RACE = 'Номер версии занят: другой администратор сохранял этот флэт одновременно с вами. Нажмите «Загрузить свежую версию» — выбранные файлы останутся';
export const MSG_VERSIONS_BUSY = 'Версии флэта заняты — сообщите администратору';
export const MSG_VERSIONS_OUT = 'Номера версий флэта исчерпаны (не больше 9999) — сообщите администратору';

export function msgTransferFailed(kind: FlatViewKind): string {
  return `Не удалось перенести вид «${VIEW_LABELS[kind]}» прежней версии — нажмите кнопку сохранения ещё раз`;
}

export function msgUploadFailed(kind: FlatViewKind): string {
  return `Файл вида «${VIEW_LABELS[kind]}» не загрузился — нажмите кнопку сохранения ещё раз. Справочник не изменён`;
}

export function msgNoFile(kind: FlatViewKind): string {
  return `Для вида «${VIEW_LABELS[kind]}» не выбран файл SVG`;
}

export function msgBrokenNeighbour(id: string, issue: string): string {
  return `Флэт «${id}» в справочнике битый: ${issue} — сохранение закроет сервер. Откройте его и исправьте`;
}

export interface SaveProgress {
  done: number;
  total: number;
  phase: 'files' | 'catalog';
}

export interface SaveFlatInput {
  /** Свежее значение строки `app_config.garmentFlats` (`null` — строки нет) */
  rawBase: unknown;
  /** Разобранная запись флэта из `rawBase` (`null` — новый флэт) */
  base: GarmentFlat | null;
  draft: GarmentFlat;
  /** Очищенные тексты новых файлов видов */
  files: Partial<Record<FlatViewKind, string>>;
  /** Свежий справочник зон; не загрузился — `null` (только предупреждение) */
  zonesCatalog?: readonly ZoneLike[] | null;
  /** Прошлое сохранение упёрлось в гонку номеров — текст исчерпания строже (К3) */
  raceRetry?: boolean;
  onProgress?: (p: SaveProgress) => void;
}

export type SaveFlatResult =
  | { ok: true; flat: GarmentFlat; raw: unknown; released: number | null }
  | { ok: false; kind: 'files' | 'conflict' | 'forbidden' | 'invalid' | 'other'; message: string };

type Failure = Extract<SaveFlatResult, { ok: false }>;

function fail(kind: Failure['kind'], message: string): Failure {
  toast.error(message);
  return { ok: false, kind, message };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const idOf = (v: unknown): string | null => (isObj(v) && typeof v.id === 'string' ? v.id : null);

/** id всех записей справочника из базы, сырыми (снятые и битые тоже заняты) */
export function rawIds(rawBase: unknown): Set<string> {
  const flats = isObj(rawBase) && Array.isArray(rawBase.flats) ? rawBase.flats : [];
  return new Set(flats.map(idOf).filter((id): id is string => id !== null));
}

/** Замечание по чужим записям склеенного справочника (как у сервера) либо `null` */
function neighbourIssue(merged: { flats: unknown[] }, ownId: string): string | null {
  const seen = new Set<string>();
  for (const [i, item] of merged.flats.entries()) {
    const id = idOf(item);
    if (id !== null && seen.has(id)) return msgBrokenNeighbour(id, 'id повторяется');
    if (id !== null) seen.add(id);
    if (id === ownId) continue;
    const issue = flatIssues(item)[0];
    if (issue) return msgBrokenNeighbour(id ?? `№${i + 1}`, issue);
  }
  const parsed = parseFlatsCatalog(merged);
  return parsed.issues[0] ?? null;
}

/** Шаг 1: всё, что проверяется без сети. Отказ — текст; иначе `null` */
function precheck(input: SaveFlatInput, provisional: GarmentFlat): string | null {
  const { rawBase, base } = input;
  if (!historyPreserved(base, provisional)) return MSG_HISTORY;
  const merged = mergeFlatIntoRaw(rawBase, provisional);
  if (merged === 'bad_shape') return MSG_BAD_SHAPE;
  const bytes = catalogBytes(merged);
  if (bytes > CATALOG_MAX_BYTES) return MSG_TOO_BIG;
  const others = parseFlatsCatalog({ version: 1, flats: merged.flats.filter((f) => idOf(f) !== provisional.id) }).catalog.flats;
  const check = validateFlat(provisional, {
    reservedIds: rawIds(rawBase),
    isNew: base === null,
    base,
    activeFlats: others.filter((f) => f.active),
    zonesCatalog: input.zonesCatalog ?? null,
    skuCodes: new Set(provisional.sku_codes),
    flatMm: {},
    catalogBytes: bytes,
  });
  if (check.errors.length > 0) return `Флэт не сохранён: ${check.errors.map((e) => e.text).join('; ')}`;
  return neighbourIssue(merged, provisional.id);
}

/**
 * Тексты всех видов будущей версии: новый файл (повторно через санитайзер —
 * в бакет не уходит неочищенное) или перенос прежнего свежим скачиванием (К2)
 */
async function viewTexts(input: SaveFlatInput): Promise<Map<FlatViewKind, string> | Failure> {
  const out = new Map<FlatViewKind, string>();
  for (const view of input.draft.views) {
    const file = input.files[view.kind];
    if (file !== undefined) {
      const clean = sanitizeSvg(file);
      if (!clean.ok) return fail('invalid', `Файл вида «${VIEW_LABELS[view.kind]}»: ${clean.error}`);
      out.set(view.kind, clean.svg);
      continue;
    }
    const prev = input.base?.views.find((v) => v.kind === view.kind);
    if (!prev) return fail('invalid', msgNoFile(view.kind));
    const text = await downloadFlatSvg(prev.svg_path);
    const resolved = text === null ? null : resolveFlat(text, prev);
    if (!resolved) return fail('files', msgTransferFailed(view.kind));
    out.set(view.kind, resolved.markup);
  }
  return out;
}

/** Загрузка всех видов по версии `start` и дальше; итог — выпущенная версия или отказ */
async function uploadRelease(
  input: SaveFlatInput,
  texts: Map<FlatViewKind, string>,
  start: number,
): Promise<number | Failure> {
  const { draft, onProgress } = input;
  const total = draft.views.length;
  let version = start;
  for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
    if (version > MAX_FLAT_VERSION) return fail('files', MSG_VERSIONS_OUT);
    onProgress?.({ done: 0, total, phase: 'files' });
    let taken = false;
    for (const [i, view] of draft.views.entries()) {
      const res = await uploadFlatSvgOnce(flatSvgPathOf(draft.id, version, view.kind), texts.get(view.kind) ?? '');
      if (res === null) return fail('files', msgUploadFailed(view.kind));
      if (res === 'differs') {
        taken = true;
        break;
      }
      onProgress?.({ done: i + 1, total, phase: 'files' });
    }
    if (!taken) return version;
    version += 1;
  }
  return fail('files', input.raceRetry ? MSG_VERSIONS_BUSY : MSG_VERSIONS_RACE);
}

/** Выпуск версии: занятые номера, тексты видов, загрузка. Итог — выпущенная запись */
async function release(input: SaveFlatInput): Promise<{ flat: GarmentFlat; version: number } | Failure> {
  const listed = await listFlatVersions(input.draft.id);
  if (listed === null) return fail('files', MSG_LIST_FAILED);
  const start = Math.max(nextVersion(input.base), (listed.at(-1) ?? 0) + 1);
  const texts = await viewTexts(input);
  if (!(texts instanceof Map)) return texts;
  const version = await uploadRelease(input, texts, start);
  if (typeof version !== 'number') return version;
  return { flat: releaseFlat(input.base, input.draft, version), version };
}

/** Сохранить флэт: файлы → справочник (порядок и отказы — в шапке модуля) */
export async function saveFlat(input: SaveFlatInput): Promise<SaveFlatResult> {
  const { rawBase, base, draft, files } = input;
  const newFiles = draft.views.map((v) => v.kind).filter((k) => files[k] !== undefined);
  const geometry = geometryChanged(base, draft, newFiles);
  const provisional = releaseFlat(base, draft, geometry ? nextVersion(base) : base!.version);
  const problem = precheck(input, provisional);
  if (problem) return fail('invalid', problem);

  let record = provisional;
  let released: number | null = null;
  if (geometry) {
    const out = await release(input);
    if ('ok' in out) return out;
    record = out.flat;
    released = out.version;
  }

  const merged = mergeFlatIntoRaw(rawBase, record);
  if (merged === 'bad_shape') return fail('invalid', MSG_BAD_SHAPE);
  if (catalogBytes(merged) > CATALOG_MAX_BYTES) return fail('invalid', MSG_TOO_BIG);
  input.onProgress?.({ done: draft.views.length, total: draft.views.length, phase: 'catalog' });
  const res = await putCatalog('app_config', 'garmentFlats', merged, rawBase ?? null);
  if (!res.ok) return { ok: false, kind: res.kind, message: res.message };
  invalidateFlatsCatalog();
  return { ok: true, flat: record, raw: merged, released };
}
