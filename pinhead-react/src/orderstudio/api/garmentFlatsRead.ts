/**
 * Флэты изделий — ЧТЕНИЕ закрытого бакета `garment-flats` (веха 5а, миграция H;
 * вынесено из `garmentFlats.ts` в вехе 5б, задача 7).
 *
 * Отдельный модуль ради бюджета холста «Дизайн»: холсту нужно только скачать
 * SVG силуэта (`design/assets/flatImages`), а писатель бакета (загрузка, сверка
 * «уже есть», список версий) нужен редактору флэта и сиду. В одном модуле
 * Rollup клал их общим чанком, и холст платил за запись («Кэши картинок»).
 * Писатель — по-прежнему только `garmentFlats.ts` (сторож `flatsWrites.test.ts`),
 * он реэкспортирует всё отсюда.
 *
 * Клиент не доверяет справочнику (прямая запись admin в `app_config` идёт мимо
 * RPC): скачивание — только по пути, прошедшему `isFlatPath`. SVG чужой: на
 * холст и в PDF он идёт только через санитайзер, здесь — только байты.
 * Ошибка → `toast.error` и `null` (правило проекта).
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';

export const FLATS_BUCKET = 'garment-flats';
/** = `allowed_mime_types` бакета */
export const FLAT_MIME = 'image/svg+xml';
/** = `file_size_limit` бакета (1 МБ; самый большой сид — около 80 КБ) */
export const FLAT_MAX_BYTES = 1048576;
/** = регулярка `garment_flat_path_ok` (без флага m: `$` — только конец строки) */
export const FLAT_PATH_RE = /^flats\/[a-z0-9][a-z0-9-]{0,62}\/v[1-9][0-9]{0,3}\/(front|back|sleeve_left|sleeve_right|hood|pocket)\.svg$/;

export function isFlatPath(p: unknown): p is string {
  return typeof p === 'string' && FLAT_PATH_RE.test(p);
}

/** Тост «контекст: причина» и `null` (общий отказ модулей флэтов) */
export function fail(context: string, message: string): null {
  toast.error(`${context}: ${message}`);
  return null;
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
