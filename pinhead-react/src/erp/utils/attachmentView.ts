/**
 * Показ вложения: подпись вида, публичный URL, «это картинка?».
 *
 * Отдельным модулем от `components/FilesBoard` не из педантизма: файл,
 * экспортирующий рядом с компонентами константы, ломает fast refresh
 * (правило `react-refresh/only-export-components`), а читают их и карточка
 * заказа, и вкладка «Файлы» разработки.
 */

import { supabase } from '../../lib/supabase';

/** Вид вложения человеку. Виды `dev_*` — файлы разработки образца */
export const ATTACH_KIND_LABEL: Record<string, string> = {
  preview: 'Превью',
  attachment: 'Вложение',
  production: 'Файл производства',
  print: 'Макет нанесения',
  label: 'Макет бирки',
  stage_result: 'Результат этапа',
  purchase_list: 'Лист закупки',
  packaging: 'Упаковка',
  tech: 'Техблок',
  purchase: 'Закупка',
  note: 'Заметка',
  dev_task: 'Файл задачи',
  dev_pattern: 'Лекала',
  dev_passport: 'Технический паспорт',
  dev_photo: 'Фото образца',
};

/** Публичный URL файла в бакете erp-attachments */
export function attachmentUrl(path: string): string {
  return supabase.storage.from('erp-attachments').getPublicUrl(path).data.publicUrl;
}

/** Не всякое вложение — картинка: у PDF и прочих рисуем иконку */
export function isImageAttachment(
  att: { file_name?: string | null; file_path: string },
): boolean {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(att.file_name || att.file_path);
}
