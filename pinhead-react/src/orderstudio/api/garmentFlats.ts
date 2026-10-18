/**
 * Флэты изделий — закрытый бакет `garment-flats` (веха 5а, миграция H
 * `…_garment_flats`).
 *
 * Путь — `flats/<flat_id>/v<N>/<вид>.svg`, ASCII, версия 1…9999. Ту же форму
 * проверяет база (`garment_flat_path_ok` в политике записи) и
 * `catalog_value_check` для `app_config.garmentFlats` (`svg_path` выводится
 * из id, версии и вида). Сторож `garmentFlatsBucket.test.ts` сверяет
 * константы и регулярку с миграцией.
 *
 * Объект неизменяем: UPDATE в бакете запрещён всем (restrictive
 * `garment_flats_no_update`), DELETE нет. Новая версия флэта — новый путь.
 * Поэтому загрузка — только `upsert: false`, а ответ «уже есть» — успех
 * (`'exists'`): путь версионный, содержимое то же (повтор сида после сбоя).
 *
 * Пишут только admin и director, читают активные и одобренные. Клиент
 * не доверяет справочнику (прямая запись admin в `app_config` идёт мимо RPC):
 * скачивание — только по пути, прошедшему `isFlatPath`.
 *
 * SVG чужой: на холст и в PDF он идёт только через санитайзер (веха 5а,
 * `design/assets/sanitizeSvg`), здесь — только байты.
 *
 * Ошибка → `toast.error` и `null` (правило проекта). Сторож
 * `flatsWrites.test.ts`: запись в бакет — только из этого модуля.
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';

export const FLATS_BUCKET = 'garment-flats';
/** = `allowed_mime_types` бакета */
export const FLAT_MIME = 'image/svg+xml';
/** = `file_size_limit` бакета (1 МБ; самый большой сид — около 80 КБ) */
export const FLAT_MAX_BYTES = 1048576;
/** Виды флэта: в 5а — перед и спина, рукава — под 5б */
export const FLAT_VIEW_KINDS = ['front', 'back', 'sleeve_left', 'sleeve_right'] as const;
export type FlatViewKind = (typeof FLAT_VIEW_KINDS)[number];

/** id флэта — как в `catalog_value_check` и CHECK `order_items.flat_id` */
export const FLAT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** = регулярка `garment_flat_path_ok` (без флага m: `$` — только конец строки) */
export const FLAT_PATH_RE = /^flats\/[a-z0-9][a-z0-9-]{0,62}\/v[1-9][0-9]{0,3}\/(front|back|sleeve_left|sleeve_right)\.svg$/;
const MAX_VERSION = 9999;

/** Путь SVG вида флэта; неверный id, версия или вид — пустая строка */
export function flatSvgPath(id: string, version: number, kind: FlatViewKind): string {
  if (!FLAT_ID_RE.test(id)) return '';
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) return '';
  if (!(FLAT_VIEW_KINDS as readonly string[]).includes(kind)) return '';
  return `flats/${id}/v${version}/${kind}.svg`;
}

export function isFlatPath(p: unknown): p is string {
  return typeof p === 'string' && FLAT_PATH_RE.test(p);
}

function fail(context: string, message: string): null {
  toast.error(`${context}: ${message}`);
  return null;
}

interface StorageError { message?: string; statusCode?: string | number; error?: string }

/** Ответ Storage «объект уже есть» (upsert: false по существующему пути) */
function isDuplicate(error: StorageError): boolean {
  return String(error.statusCode ?? '') === '409'
    || /duplicate|already exists/i.test(`${error.error ?? ''} ${error.message ?? ''}`);
}

/**
 * Загрузить SVG вида флэта. `'uploaded'` — записан, `'exists'` — по этому
 * пути объект уже есть (версии неизменяемы — это успех), `null` — отказ.
 */
export async function uploadFlatSvg(path: string, svgText: string): Promise<'uploaded' | 'exists' | null> {
  const context = 'Флэт не загружен';
  if (!isFlatPath(path)) return fail(context, 'неверный путь');
  const bytes = new TextEncoder().encode(svgText).length;
  if (bytes === 0) return fail(context, 'файл пустой');
  if (bytes > FLAT_MAX_BYTES) return fail(context, 'файл больше 1 МБ');
  const body = new Blob([svgText], { type: FLAT_MIME });
  try {
    const { error } = await supabase.storage.from(FLATS_BUCKET).upload(path, body, { upsert: false, contentType: FLAT_MIME });
    if (error) {
      if (isDuplicate(error as StorageError)) return 'exists';
      console.error('uploadFlatSvg', error);
      return fail(context, translateSupabaseError(error.message));
    }
    return 'uploaded';
  } catch (e) {
    console.error('uploadFlatSvg', e);
    return fail(context, networkFailureMessage(e));
  }
}

/** Текст SVG вида флэта либо `null` (путь не флэта, ошибка, больше лимита) */
export async function downloadFlatSvg(path: string): Promise<string | null> {
  const context = 'Флэт не загружен с сервера';
  if (!isFlatPath(path)) return fail(context, 'неверный путь в справочнике');
  try {
    const { data, error } = await supabase.storage.from(FLATS_BUCKET).download(path);
    if (error || !data) {
      console.error('downloadFlatSvg', error);
      return fail(context, error ? translateSupabaseError(error.message) : 'пустой ответ');
    }
    if (data.size > FLAT_MAX_BYTES) return fail(context, 'файл больше 1 МБ');
    return await data.text();
  } catch (e) {
    console.error('downloadFlatSvg', e);
    return fail(context, networkFailureMessage(e));
  }
}
