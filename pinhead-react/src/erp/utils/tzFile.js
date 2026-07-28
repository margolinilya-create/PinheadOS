import { supabase } from '../../lib/supabase';
import { TZ_BUCKET } from '../types';
import { formatDateShort } from './time';

/**
 * Ссылка и подпись файла ТЗ. Отдельно от TzViewer.jsx: react-refresh требует,
 * чтобы модуль компонента экспортировал только компоненты.
 */

/** Публичная ссылка на файл ТЗ в бакете erp-attachments */
export function tzFileUrl(filePath) {
  return supabase.storage.from(TZ_BUCKET).getPublicUrl(filePath).data.publicUrl;
}

/** Подпись документа: имя файла · версия · кто и когда загрузил */
export function tzCaption(doc) {
  return [
    doc.file_name || 'ТЗ.pdf',
    doc.version > 1 ? `версия ${doc.version}` : null,
    doc.uploaded_by,
    formatDateShort(doc.created_at),
  ].filter(Boolean).join(' · ');
}
