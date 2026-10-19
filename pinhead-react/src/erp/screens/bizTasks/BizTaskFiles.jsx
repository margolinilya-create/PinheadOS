import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useErpStore } from '../../store/useErpStore';
import { useAttachmentUploads } from '../../hooks/useAttachmentUploads';
import { AttachmentPicker } from '../../components/AttachmentPicker';
import { Button } from '../../components/Button';
import { attachmentUrl } from '../../utils/attachmentView';
import { FILE_ORIGIN_LABELS, fileOrigin, formatMoment } from './bizTaskCardView';
import styles from './BizTaskCard.module.css';

/** Вид вложения задачи — папка `att/<заказ>/biz_task/` (писатель сверяет префикс) */
const FILE_KIND = 'biz_task';

/**
 * ФАЙЛЫ ЗАДАЧИ (правки 19.10, п. 7): описания, обсуждения и результата —
 * с автором, временем и ссылкой на исходное сообщение. Хранение — принятое
 * в ERP: публичный бакет `erp-attachments` по ссылке (Р7).
 *
 * Приложить может тот, кому `bizTaskActions` дал `attach` (участник или
 * руководитель). Файл грузится в бакет ПРИ ВЫБОРЕ (правило проекта: видимый
 * приложенным файл обязан быть в бакете), «Приложить» лишь привязывает
 * загруженное к задаче писателем `erp_biz_task_attach`.
 */
export function BizTaskFiles({ task, files, names, canAttach }) {
  const headId = useId();
  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h2 id={headId} className={styles.blockTitle}>Файлы</h2>
      {files.length === 0 ? (
        <p className={styles.muted}>Файлов пока нет.</p>
      ) : (
        <ul className={styles.files}>
          {files.map((f) => (
            <li key={f.id} className={styles.file}>
              <a href={attachmentUrl(f.file_path)} target="_blank" rel="noopener noreferrer">
                {f.file_name || 'файл'}
              </a>
              <span className={styles.eventMeta}>
                {`${FILE_ORIGIN_LABELS[fileOrigin(f, task)]} · ${names.get(f.uploaded_by) ?? '—'} · ${formatMoment(f.created_at)}`}
              </span>
              {f.message_id && (
                <Link to={`/biz-tasks/${task.id}?msg=${f.message_id}&pane=chat`}>К сообщению</Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAttach && <AttachFiles task={task} />}
    </section>
  );
}

function AttachFiles({ task }) {
  const attach = useErpStore((s) => s.attachBizTaskFiles);
  const uploads = useAttachmentUploads(task.order_id);
  const [busy, setBusy] = useState(false);
  const ready = uploads.files.length > 0 && !uploads.uploading && !uploads.failed;
  const reason = uploads.uploading ? 'Дождитесь загрузки файлов'
    : uploads.failed ? 'Загрузите заново или уберите файл с ошибкой' : '';

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const payload = uploads.payload().map((f) => ({ file_path: f.file_path, file_name: f.file_name }));
    const row = await attach(task.id, payload);
    setBusy(false);
    // Отказ уже объявлен тостом стора; выбранные файлы остаются для повтора
    if (row) uploads.clear();
  };

  return (
    <div className={styles.attach}>
      <AttachmentPicker
        label="Приложить файлы"
        files={uploads.files}
        kind={FILE_KIND}
        onAdd={uploads.add}
        onRetry={uploads.retry}
        onRemove={uploads.remove}
        hint="До 30 МБ на один файл"
      />
      {uploads.files.length > 0 && (
        <Button variant="primary" size="sm" loading={busy} ariaDisabledReason={reason} onClick={submit}>
          Приложить к задаче
        </Button>
      )}
    </div>
  );
}
