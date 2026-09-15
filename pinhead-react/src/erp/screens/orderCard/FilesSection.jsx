import { useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { confirm } from '../../../store/useConfirmStore';
import {
  ORDER_FOLDERS, filesInFolder, kindForFolder, moveTargetOf,
} from '../../utils/orderFolders';
import styles from '../../styles';

const ATTACH_KIND_LABEL = {
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
};

/** Публичный URL файла заказа в бакете erp-attachments */
function attachmentUrl(path) {
  return supabase.storage.from('erp-attachments').getPublicUrl(path).data.publicUrl;
}

/** Не всякое вложение — картинка: у PDF и прочих рисуем иконку */
function isImage(att) {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(att.file_name || att.file_path);
}

function FileCard({ att, canManage, onRemove, onMove, busy }) {
  const url = attachmentUrl(att.file_path);
  const target = moveTargetOf(att);
  const targetTitle = target
    ? ORDER_FOLDERS.find((f) => f.key === target)?.title
    : null;
  const name = att.file_name || 'файл';

  return (
    <div className={styles.fileCard}>
      <a href={url} target="_blank" rel="noreferrer" className={styles.fileCardLink}>
        {isImage(att) ? (
          <img
            src={url} alt={name} className={styles.fileThumb} loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <span className={styles.fileThumbStub} aria-hidden="true">
            <Icon name="orders" size={28} />
          </span>
        )}
        <span className={styles.fileName}>
          {ATTACH_KIND_LABEL[att.kind] ? `${ATTACH_KIND_LABEL[att.kind]} · ` : ''}
          {name}
        </span>
      </a>
      {canManage && (
        <div className={styles.fileCardActions}>
          {/*
            ПЕРЕМЕЩАЕТСЯ НЕ ВСЁ, и кнопки у неперемещаемого файла нет вовсе.
            У макета нанесения есть адресат (`print_id`) — смена вида оторвала
            бы его от нанесения, и цех перестал бы видеть макет в задании.
            То же правило стоит на сервере (`erp_attachment_guard`): кнопка,
            которой сервер откажет, хуже отсутствующей.
          */}
          {target && (
            <Button
              variant="secondary" size="sm" disabled={busy}
              onClick={() => onMove(att, target)}
            >
              → {targetTitle}
            </Button>
          )}
          <Button
            variant="secondary" size="sm" disabled={busy}
            aria-label={`Удалить файл ${name}`}
            onClick={() => onRemove(att)}
          >
            Удалить
          </Button>
        </div>
      )}
    </div>
  );
}

function Folder({ folder, files, canManage, onUpload, onRemove, onMove, busy }) {
  const inputRef = useRef(null);

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <strong>{folder.title}</strong>
        {canManage && (
          <>
            <Button
              variant="secondary" size="sm" disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Загрузить
            </Button>
            {/*
              Файл уходит в бакет СРАЗУ по выбору — правило проекта: интерфейс
              не должен показывать приложенным то, чего в Storage нет.
            */}
            <input
              ref={inputRef}
              type="file"
              multiple
              className={styles.visuallyHidden}
              aria-label={`Загрузить в «${folder.title}»`}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (picked.length > 0) onUpload(folder.key, picked);
              }}
            />
          </>
        )}
      </div>
      <div className={styles.subText}>{folder.hint}</div>
      {files.length === 0 ? (
        <div className={styles.subText}>Файлов нет.</div>
      ) : (
        <div className={styles.fileGrid}>
          {files.map((a) => (
            <FileCard
              key={a.id} att={a} canManage={canManage} busy={busy}
              onRemove={onRemove} onMove={onMove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

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

  return (
    <>
      {ORDER_FOLDERS.map((folder) => (
        <Folder
          key={folder.key}
          folder={folder}
          files={filesInFolder(attachments, folder.key)}
          canManage={canManage}
          busy={busy}
          onUpload={upload}
          onRemove={remove}
          onMove={move}
        />
      ))}
    </>
  );
}
