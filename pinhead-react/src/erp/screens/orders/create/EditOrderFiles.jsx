import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../../store/useErpStore';
import { useErpAccess } from '../../../store/useErpAccess';
import { confirm } from '../../../../store/useConfirmStore';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { ATTACH_KIND_LABEL, attachmentUrl } from '../../../utils/attachmentView';
import { canRemoveOrderAttachment } from '../../../utils/attachmentRights';
import { currentDocuments, itemLabel } from '../../../utils/tz';
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
 */

/** Кнопка + скрытый input: файл уходит в работу сразу по выбору */
function PickButton({ label, ariaLabel, onPick, disabled, variant = 'ghost', multiple = false }) {
  const ref = useRef(null);
  return (
    <span>
      <Button
        variant={variant}
        size="sm"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => ref.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        multiple={multiple}
        className={styles.visuallyHidden}
        aria-label={ariaLabel ?? label}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          // Сброс значения: иначе повторный выбор того же файла не поднимет change
          e.target.value = '';
          for (const f of picked) onPick(f);
        }}
      />
    </span>
  );
}

const OP_TEXT = { replacing: 'заменяется…', removing: 'удаляется…' };

/**
 * Список файлов одного блока с действиями. Знания «куда привязан файл» здесь
 * нет — его приносит вызывающий в `onUpload`/`onReplace`/`onRemove`; каждый
 * возвращает `true`, когда сервер подтвердил.
 *
 * `files` — `[{ id, name, path, subtitle?, canChange }]`.
 */
export function EditableFiles({
  title, files, emptyText, uploadLabel, canUpload,
  onUpload, onReplace, onRemove, removeMessage, track,
}) {
  const [ops, setOps] = useState({});
  const [failed, setFailed] = useState({});
  const [uploads, setUploads] = useState([]);

  const run = async (id, op, action, failText) => {
    setOps((o) => ({ ...o, [id]: op }));
    setFailed((f) => ({ ...f, [id]: null }));
    let ok = false;
    try {
      ok = Boolean(await track(action()));
    } finally {
      setOps((o) => ({ ...o, [id]: null }));
    }
    if (!ok) setFailed((f) => ({ ...f, [id]: failText }));
  };

  const startUpload = async (uid, file) => {
    setUploads((u) => u.map((x) => (x.uid === uid ? { ...x, state: 'uploading' } : x)));
    let ok = false;
    try {
      ok = Boolean(await track(onUpload(file)));
    } catch {
      ok = false;
    }
    // Загруженный уходит из «ожидающих»: дальше его показывает сам заказ
    setUploads((u) => (ok
      ? u.filter((x) => x.uid !== uid)
      : u.map((x) => (x.uid === uid ? { ...x, state: 'error' } : x))));
  };

  const upload = (file) => {
    const uid = crypto.randomUUID();
    setUploads((u) => [...u, { uid, file, state: 'uploading' }]);
    startUpload(uid, file);
  };

  const remove = async (f) => {
    const ok = await confirm({
      title: 'Удалить файл?',
      message: removeMessage(f),
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (!ok) return;
    await run(f.id, 'removing', () => onRemove(f), 'не удалён — повторите');
  };

  const replace = (f, file) => run(f.id, 'replacing', () => onReplace(f, file), 'не заменён — повторите');

  return (
    <div className={styles.attachBlock}>
      <div className={styles.checkRow}>
        {title && <span className={styles.fieldLabel}>{title}</span>}
        {canUpload && (
          <PickButton
            label={uploadLabel}
            ariaLabel={`${uploadLabel}${title ? ` — ${title}` : ''}`}
            variant="secondary"
            multiple
            onPick={upload}
          />
        )}
      </div>
      {files.length === 0 && uploads.length === 0 && (
        <p className={styles.subText}>{emptyText}</p>
      )}
      {(files.length > 0 || uploads.length > 0) && (
        <ul className={styles.attachList}>
          {files.map((f) => {
            const op = ops[f.id];
            return (
              <li key={f.id} className={styles.attachRow}>
                <Icon name={op ? 'clock' : 'file'} size={13} />
                <a
                  href={attachmentUrl(f.path)}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.attachName}
                  title={f.name}
                >
                  {f.name}
                </a>
                {f.subtitle && <span className={styles.subText}>{f.subtitle}</span>}
                {op && <span className={styles.subText} role="status">{OP_TEXT[op]}</span>}
                {!op && failed[f.id] && (
                  <span className={styles.overdue} role="status">{failed[f.id]}</span>
                )}
                {f.canChange && (
                  <>
                    <PickButton
                      label="Заменить"
                      ariaLabel={`Заменить файл ${f.name}`}
                      disabled={Boolean(op)}
                      onPick={(file) => replace(f, file)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={Boolean(op)}
                      aria-label={`Удалить файл ${f.name}`}
                      onClick={() => remove(f)}
                    >
                      Удалить
                    </Button>
                  </>
                )}
              </li>
            );
          })}
          {uploads.map((u) => (
            <li key={u.uid} className={styles.attachRow}>
              <Icon name={u.state === 'error' ? 'alert' : 'clock'} size={13} />
              <span className={styles.attachName} title={u.file.name}>{u.file.name}</span>
              {u.state === 'uploading' ? (
                <span className={styles.subText} role="status">загружается…</span>
              ) : (
                <>
                  <span className={styles.overdue} role="status">не загрузился</span>
                  <Button variant="ghost" size="sm" onClick={() => startUpload(u.uid, u.file)}>
                    Загрузить заново
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Убрать файл ${u.file.name}`}
                    onClick={() => setUploads((x) => x.filter((y) => y.uid !== u.uid))}
                  >
                    Убрать
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
