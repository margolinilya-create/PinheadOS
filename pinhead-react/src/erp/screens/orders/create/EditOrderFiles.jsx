import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../../store/useErpStore';
import { useErpAccess } from '../../../store/useErpAccess';
import { TZ_MAX_BYTES } from '../../../types';
import { ATTACH_KIND_LABEL } from '../../../utils/attachmentView';
import { canRemoveOrderAttachment } from '../../../utils/attachmentRights';
import { fileLimitCaption } from '../../../utils/fileLimitText';
import { currentDocuments, itemLabel } from '../../../utils/tz';
import { EditableFiles } from './EditableFiles';
import { FieldError, FormSection } from './FormParts';
import styles from '../../../styles';

/**
 * ФАЙЛЫ ЗАКАЗА В ФОРМЕ ПРАВКИ (правка заказчика 01.10, п. 6).
 *
 * «При редактировании заказа должна быть возможность изменять загруженные
 * файлы: удалять ранее загруженные, загружать новые взамен старых; для всех
 * файлов заказа — ТЗ, листов закупки и других вложений; после сохранения
 * в заказе отображаются актуальные версии».
 *
 * ЭТО ОТМЕНЯЕТ РЕШЕНИЕ 12.09 (баг 03) «форма только показывает, файлы
 * ведутся в карточке». Двух поверхностей с разной логикой при этом не
 * заводится: здесь те же действия стора, что у карточки, — `uploadTzDocument`/
 * `replaceTzDocument`/`removeTzDocument` и `uploadOrderAttachment`/
 * `deleteOrderAttachment`.
 *
 * ДЕЙСТВИЕ ПРИМЕНЯЕТСЯ СРАЗУ, а не на «Сохранить изменения»: правило проекта
 * «файл уходит в бакет при выборе», и форма не должна показывать приложенным
 * то, чего в Storage нет, — равно как и снятым то, что в заказе осталось.
 * Поэтому у каждого файла своё состояние (загружается / заменяется /
 * удаляется / ошибка), удаление ждёт ответа сервера (не оптимистично),
 * а «Сохранить изменения» заблокирована, пока операция идёт (`track`).
 *
 * ЗАМЕНА = загрузить новый и снять старый, СТРОГО в этом порядке: старый
 * снимается только после того, как новый лёг в заказ. Перезаписывать объект
 * в бакете нельзя — на него могут ссылаться. У ТЗ замена — новая версия
 * в той же группе, история остаётся.
 *
 * Сам список файлов с действиями — `EditableFiles` (вынесен 19.10, п. 4:
 * им же пользуется карточка заказа, не подтягивая форму).
 */

/**
 * ТЗ заказа: общее (`item_id = null`) и по позициям — ровно как их делит
 * форма создания. Все действия под `tz.manage` — тем же правом, что
 * политики `erp_tz_documents` и RPC `erp_tz_document_remove`.
 */
export function EditTzFiles({ order, track }) {
  const { uploadTzDocument, replaceTzDocument, removeTzDocument } = useErpStore(useShallow((s) => ({
    uploadTzDocument: s.uploadTzDocument,
    replaceTzDocument: s.replaceTzDocument,
    removeTzDocument: s.removeTzDocument,
  })));
  const canManage = useErpAccess().can('tz.manage');
  const docs = currentDocuments(order);
  const toFiles = (list) => list.map((d) => ({
    id: d.group_id,
    groupId: d.group_id,
    name: d.file_name || 'ТЗ',
    path: d.file_path,
    subtitle: d.version > 1 ? `версия ${d.version}` : null,
    canChange: canManage,
  }));
  const blocks = [
    { key: 'order', title: 'Общее ТЗ заказа', itemId: null },
    ...(order.items ?? []).map((it) => ({ key: it.id, title: `ТЗ: ${itemLabel(it)}`, itemId: it.id })),
  ];

  return (
    <>
      {blocks.map((b) => (
        <EditableFiles
          key={b.key}
          title={b.title}
          files={toFiles(docs.filter((d) => d.item_id === b.itemId))}
          emptyText="Не приложено."
          uploadLabel="+ Загрузить ТЗ"
          canUpload={canManage}
          maxBytes={TZ_MAX_BYTES}
          caption={fileLimitCaption(TZ_MAX_BYTES)}
          onUpload={(file) => uploadTzDocument({ orderId: order.id, itemId: b.itemId, file })}
          onReplace={(f, file) => replaceTzDocument(f.groupId, file)}
          onRemove={(f) => removeTzDocument(f.groupId)}
          removeMessage={(f) => `«${f.name}» перестанет быть ТЗ ${b.itemId ? 'позиции' : 'заказа'}: `
            + 'цеха его больше не увидят. История версий сохранится.'}
          track={track}
        />
      ))}
      {!canManage && (
        <p className={styles.subText}>Менять ТЗ может только тот, у кого есть право вести ТЗ.</p>
      )}
    </>
  );
}

/** Привязки старого файла — замена встаёт туда же (макет — к своему нанесению) */
function linksOf(att) {
  return {
    item_id: att.item_id ?? null,
    material_id: att.material_id ?? null,
    stage_id: att.stage_id ?? null,
    print_id: att.print_id ?? null,
    label_id: att.label_id ?? null,
    note_id: att.note_id ?? null,
  };
}

/**
 * Вложения заказа одного или нескольких видов: лист закупки и «Файлы заказа»
 * (упаковка, техблок, макеты, заметки, свободные файлы). Право снять и
 * заменить — `canRemoveOrderAttachment`, зеркало DELETE-политики: замена
 * без права снять оставила бы два файла рядом.
 */
export function EditAttachmentFiles({
  order, kinds, uploadKind, uploadLabel, emptyText, title = null, track,
}) {
  const { uploadOrderAttachment, deleteOrderAttachment } = useErpStore(useShallow((s) => ({
    uploadOrderAttachment: s.uploadOrderAttachment,
    deleteOrderAttachment: s.deleteOrderAttachment,
  })));
  const access = useErpAccess();
  const itemById = new Map((order.items ?? []).map((it) => [it.id, it]));
  const files = (order.attachments ?? [])
    .filter((a) => kinds.includes(a.kind))
    .map((a) => ({
      id: a.id,
      att: a,
      name: a.file_name || 'файл',
      path: a.file_path,
      subtitle: kinds.length > 1
        ? [ATTACH_KIND_LABEL[a.kind], a.item_id && itemById.get(a.item_id)
          ? itemLabel(itemById.get(a.item_id)) : null].filter(Boolean).join(' · ')
        : null,
      canChange: canRemoveOrderAttachment(a, access.can, access.isAdmin),
    }));

  const replace = async (f, file) => {
    const ok = await uploadOrderAttachment(order.id, file, undefined, f.att.kind, linksOf(f.att));
    if (!ok) return false;
    return deleteOrderAttachment(order.id, f.att.id);
  };

  return (
    <EditableFiles
      title={title}
      files={files}
      emptyText={emptyText}
      uploadLabel={uploadLabel}
      canUpload={access.can('order.manage')}
      onUpload={(file) => uploadOrderAttachment(order.id, file, undefined, uploadKind)}
      onReplace={replace}
      onRemove={(f) => deleteOrderAttachment(order.id, f.att.id)}
      removeMessage={(f) => `«${f.name}» будет снят с заказа — удаление необратимо.`}
      track={track}
    />
  );
}

/**
 * Лист закупки в правке: отметка «Закупка не требуется» (поле ЗАКАЗА — оно
 * вырезает этап `supply` из маршрута) и сами файлы листа.
 */
export function EditPurchaseList({ order, notRequired, onToggleNotRequired, error, track }) {
  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={notRequired}
          onChange={(e) => onToggleNotRequired(e.target.checked)}
        />
        <span>Закупка не требуется</span>
      </label>
      {!notRequired && (
        <EditAttachmentFiles
          order={order}
          kinds={['purchase_list']}
          uploadKind="purchase_list"
          uploadLabel="+ Лист закупки"
          emptyText="Лист закупки к заказу не приложен."
          track={track}
        />
      )}
      {error && <FieldError id="err-purchase-list" text={error} />}
    </>
  );
}

/**
 * Виды секции «Файлы заказа» в правке: то, что заводит форма (упаковка,
 * техблок, макеты, бирки, заметки, файлы подрядчику), и свободные файлы
 * сделки. Лист закупки — в своей секции. Файлы чата, результаты этапов
 * и файлы разработки — не форма заказа: у них свой хозяин.
 */
const OTHER_FILE_KINDS = [
  'attachment', 'production', 'preview', 'note', 'packaging', 'tech',
  'print', 'label', 'purchase', 'subcontract',
];

/** «Для всех файлов заказа — ТЗ, листов закупки и других вложений» (п. 6) */
export function EditOtherFilesSection({ order, open, onToggle, track }) {
  const count = (order.attachments ?? []).filter((a) => OTHER_FILE_KINDS.includes(a.kind)).length;
  return (
    <FormSection
      id="order-section-files"
      title="Файлы заказа"
      summary={`${count}`}
      open={open}
      onToggle={onToggle}
    >
      <EditAttachmentFiles
        order={order}
        kinds={OTHER_FILE_KINDS}
        uploadKind="attachment"
        uploadLabel="+ Файл сделки"
        emptyText="Других файлов у заказа нет."
        track={track}
      />
    </FormSection>
  );
}
