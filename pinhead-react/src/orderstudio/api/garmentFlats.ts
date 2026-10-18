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
 * Веха 5б (задача 3, К3): редактор флэта грузит через `uploadFlatSvgOnce` —
 * «уже есть» сверяется содержимым (`'same'` — повтор после сбоя, `'differs'` —
 * номер занят другим сохранением, нужна следующая версия). Занятые номера
 * версий — `listFlatVersions` (чтение папки, писателем не считается).
 * Виды, форма id и формула пути — из `design/types` и `design/limits`
 * (один источник с дизайном), здесь реэкспорт для сторожа бакета.
 *
 * Ошибка → `toast.error` и `null` (правило проекта). Сторож
 * `flatsWrites.test.ts`: запись в бакет — только из этого модуля.
 *
 * Чтение (`downloadFlatSvg`, `isFlatPath`, константы бакета) — в
 * `garmentFlatsRead.ts`, здесь реэкспорт (веха 5б, задача 7): холст «Дизайн»
 * берёт только чтение, и писатель редактора и сида не попадает в его бюджет
 * («Кэши картинок» ≤ 9 400 Б gzip).
 */
import { supabase } from '../../lib/supabase';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';
import { FLAT_VIEW_KINDS, type FlatViewKind } from '../design/types';
import { FLAT_ID_RE, MAX_FLAT_VERSION, flatSvgPathOf } from '../design/limits';
import {
  FLATS_BUCKET, FLAT_MAX_BYTES, FLAT_MIME, downloadFlatSvg, fail, isFlatPath,
} from './garmentFlatsRead';

export { FLAT_VIEW_KINDS, FLAT_ID_RE };
export type { FlatViewKind };
export { FLATS_BUCKET, FLAT_MIME, FLAT_MAX_BYTES, FLAT_PATH_RE, isFlatPath, downloadFlatSvg } from './garmentFlatsRead';

/** Путь SVG вида флэта; неверный id, версия или вид — пустая строка */
export function flatSvgPath(id: string, version: number, kind: FlatViewKind): string {
  if (!FLAT_ID_RE.test(id)) return '';
  if (!Number.isInteger(version) || version < 1 || version > MAX_FLAT_VERSION) return '';
  if (!(FLAT_VIEW_KINDS as readonly string[]).includes(kind)) return '';
  return flatSvgPathOf(id, version, kind);
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

/**
 * Загрузка для редактора флэта (К3): «уже есть» сверяется содержимым.
 * `'uploaded'` — записан; `'same'` — по пути уже лежит тот же текст (повтор
 * после сбоя; оба текста — выход санитайзера, он идемпотентен); `'differs'` —
 * по пути чужой текст (сирота сорвавшегося сохранения или второй
 * администратор): номер версии занят. Отказ — `null` (тост уже показан).
 */
export async function uploadFlatSvgOnce(path: string, svg: string): Promise<'uploaded' | 'same' | 'differs' | null> {
  const res = await uploadFlatSvg(path, svg);
  if (res !== 'exists') return res;
  const stored = await downloadFlatSvg(path);
  if (stored === null) return null;
  return stored === svg ? 'same' : 'differs';
}

/** Папка версии флэта в бакете: `v<N>`, N = 1…9999 без ведущих нулей */
const VERSION_DIR_RE = /^v([1-9][0-9]{0,3})$/;
/** Строк на страницу `list` */
const LIST_PAGE = 1000;

/**
 * Занятые номера версий флэта в бакете — по возрастанию (К3: стартовая версия
 * выпуска считается и по бакету, иначе сироты навсегда закрыли бы выпуск).
 * Чтение папки, не запись. Ошибка — `toast.error` и `null`.
 */
export async function listFlatVersions(id: string): Promise<number[] | null> {
  const context = 'Не удалось прочитать версии флэта';
  if (!FLAT_ID_RE.test(id)) return fail(context, 'неверный id флэта');
  const found = new Set<number>();
  try {
    for (let offset = 0; offset <= MAX_FLAT_VERSION; offset += LIST_PAGE) {
      const { data, error } = await supabase.storage.from(FLATS_BUCKET).list(`flats/${id}`, { limit: LIST_PAGE, offset });
      if (error || !data) {
        console.error('listFlatVersions', error);
        return fail(context, error ? translateSupabaseError(error.message) : 'пустой ответ');
      }
      for (const item of data) {
        const m = VERSION_DIR_RE.exec(String(item?.name ?? ''));
        if (m) found.add(Number(m[1]));
      }
      if (data.length < LIST_PAGE) break;
    }
  } catch (e) {
    console.error('listFlatVersions', e);
    return fail(context, networkFailureMessage(e));
  }
  return [...found].sort((a, b) => a - b);
}
