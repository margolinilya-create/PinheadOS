import { useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { confirm } from '../../../store/useConfirmStore';
import { FileFolder } from '../../components/FilesBoard';
import {
  ORDER_FOLDERS, filesInFolder, kindForFolder, moveTargetOf,
} from '../../utils/orderFolders';

/**
 * Вложения заказа — ДВЕ ПАПКИ (правка заказчика 14.09, п. 3).
 *
 * «Общие файлы сделки и рабочие производственные файлы должны быть
 * разделены»; разбор по папкам — `utils/orderFolders`, он же решает, что
 * вправе ходить между ними.
 *
 * ЗАМЕНЫ ФАЙЛА ОТДЕЛЬНЫМ ДЕЙСТВИЕМ НЕТ, и это не пропуск: замена — это
 * загрузить новый и снять старый. Перезаписывать объект в бакете нельзя,
 * на него уже могут быть ссылки, а прежняя версия нужна тем, кто её видел.
 *
 * ПОКАЗ ЖИВЁТ В ОБЩЕМ `components/FilesBoard` (правка 21.09, п. 7): вкладка
 * «Файлы» экспериментального цеха просит «ту же логику работы с файлами,
 * которая уже используется в заказе», и «ту же» здесь значит тот же код.
 */
export function FilesSection({ orderId, attachments }) {
  const { uploadOrderAttachment, deleteOrderAttachment, moveOrderAttachment } = useErpStore();
  const canManage = useErpAccess().can('files.manage');
  const [busy, setBusy] = useState(false);

  const upload = async (folderKey, files) => {
    setBusy(true);
    try {
      for (const file of files) {
        // Последовательно, а не пачкой: при отказе на середине человек должен
        // увидеть, что именно загрузилось, а не гадать по общему сообщению
        await uploadOrderAttachment(orderId, file, undefined, kindForFolder(folderKey));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (att) => {
    const ok = await confirm({
      title: 'Удалить файл?',
      message: `${att.file_name || 'файл'} — удаление необратимо: файл уйдёт и из хранилища.`,
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteOrderAttachment(orderId, att.id);
    } finally {
      setBusy(false);
    }
  };

  const move = async (att, target) => {
    setBusy(true);
    try {
      await moveOrderAttachment(orderId, att.id, kindForFolder(target));
    } finally {
      setBusy(false);
    }
  };

  /**
   * ПЕРЕМЕЩАЕТСЯ НЕ ВСЁ, и кнопки у неперемещаемого файла нет вовсе.
   * У макета нанесения есть адресат (`print_id`) — смена вида оторвала бы его
   * от нанесения, и цех перестал бы видеть макет в задании. То же правило
   * стоит на сервере (`erp_attachment_guard`).
   */
  const moveTargetFor = (att) => {
    const target = moveTargetOf(att);
    if (!target) return null;
    return {
      title: ORDER_FOLDERS.find((f) => f.key === target)?.title,
      onMove: () => move(att, target),
    };
  };

  return (
    <>
      {ORDER_FOLDERS.map((folder) => (
        <FileFolder
          key={folder.key}
          folder={folder}
          files={filesInFolder(attachments, folder.key)}
          canManage={canManage}
          busy={busy}
          onUpload={upload}
          onRemove={remove}
          moveTargetFor={moveTargetFor}
        />
      ))}
    </>
  );
}
