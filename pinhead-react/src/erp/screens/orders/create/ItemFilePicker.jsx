import { AttachmentPicker } from '../../../components/AttachmentPicker';

/**
 * Пикер файлов позиции поверх `useAttachmentUploads` формы заказа.
 *
 * `attach = null` — режим правки (п. 6 правки 01.10): пикера нет вовсе.
 * Сохранение правки вложений не несёт, и загрузка «на будущее» оставляла бы
 * сирот в бакете; файлы позиций в правке ведёт секция «Файлы заказа».
 * Вынесено из `ItemBlock` вместе с общими пропсами (`files`/`onRetry`/
 * `onRemove`), которые у всех пяти пикеров позиции одинаковы.
 */
export function ItemFilePicker({ attach, ...props }) {
  if (!attach) return null;
  return (
    <AttachmentPicker
      files={attach.files}
      onRetry={attach.retry}
      onRemove={attach.remove}
      {...props}
    />
  );
}
