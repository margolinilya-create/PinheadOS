/**
 * КТО ВПРАВЕ СНЯТЬ ВЛОЖЕНИЕ ЗАКАЗА — клиентское зеркало DELETE-политики
 * `erp_order_attachments_delete` (миграция 20261001185758, правка 01.10, п. 6).
 *
 * Страж разрешает ровно то, что разрешает интерфейс: кнопка «Удалить» /
 * «Заменить» у файла, которому сервер откажет, — это «кнопка есть, действие
 * падает», а замена к тому же успела бы загрузить новый файл рядом со старым.
 * Списки видов ниже сторож `attachmentRights.test.ts` сверяет с самой
 * миграцией — расхождение ловится тестом, а не жалобой.
 *
 * Ветка файлов разработки (`experimental.manage`) здесь не повторена: форма
 * заказа их не показывает, и решать за неё нечего.
 */

import type { ErpOrderAttachment, ErpPermission } from '../types';

/** Свободные файлы и макеты — под `files.manage` (правка 14.09, п. 3) */
export const FILES_MANAGE_DELETE_KINDS = ['attachment', 'production', 'print', 'label'] as const;

/** Файлы, которые заводит форма заказа, — под `order.manage` (правка 01.10, п. 6) */
export const ORDER_MANAGE_DELETE_KINDS = [
  'attachment', 'purchase_list', 'purchase', 'packaging', 'tech', 'note', 'preview',
] as const;

export function canRemoveOrderAttachment(
  att: Pick<ErpOrderAttachment, 'kind' | 'stage_id'>,
  can: (permission: ErpPermission) => boolean,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  const kind = att.kind as string;
  if (att.stage_id && kind === 'subcontract' && can('order.manage')) return true;
  if ((FILES_MANAGE_DELETE_KINDS as readonly string[]).includes(kind) && can('files.manage')) {
    return true;
  }
  return (ORDER_MANAGE_DELETE_KINDS as readonly string[]).includes(kind) && can('order.manage');
}
