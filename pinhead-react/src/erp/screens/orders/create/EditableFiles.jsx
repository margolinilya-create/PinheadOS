import { useRef, useState } from 'react';
import { confirm } from '../../../../store/useConfirmStore';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { attachmentUrl } from '../../../utils/attachmentView';
import { batchStatusText, tooBigText } from '../../../utils/fileLimitText';
import { useRemovalFocus } from './useRemovalFocus';
import styles from '../../../styles';

/**
 * СПИСОК ФАЙЛОВ С ДЕЙСТВИЯМИ — общий для формы правки и карточки заказа.
 *
 * Вынесен из `EditOrderFiles.jsx` (правка 19.10, п. 4): карточка заказа
 * грузит ТЗ пачкой тем же списком, и импорт из файла формы тянул бы в её
 * чанк саму форму (`FormParts`, стор правки, справочники вложений).
 *
 * ПАЧКА: один выбор — несколько файлов, у каждого своя строка и своё
 * состояние; соседи друг друга не ждут и не блокируют. Файл больше `maxBytes`
 * в работу не уходит: его строка сразу называет причину, «Загрузить заново»
 * у неё нет — повтор упрётся в тот же лимит. Состояние пачки объявляет ОДИН
 * `role="status"` блока; у строк своей роли нет.
 *
 * Знания «куда привязан файл» здесь нет — его приносит вызывающий
 * в `onUpload`/`onReplace`/`onRemove`; каждый возвращает истину, когда
 * сервер подтвердил. `files` — `[{ id, name, path, subtitle?, canChange }]`.
 */

/** Кнопка + скрытый input: файл уходит в работу сразу по выбору */
function PickButton({
  label, ariaLabel, onPick, disabled, variant = 'ghost', multiple = false, pickFocus = false,
}) {
  const ref = useRef(null);
  return (
    <span>
      <Button
        variant={variant}
        size="sm"
        disabled={disabled}
        aria-label={ariaLabel}
        data-pick-focus={pickFocus || undefined}
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
          if (picked.length > 0) onPick(picked);
        }}
      />
    </span>
  );
}

const OP_TEXT = { replacing: 'заменяется…', removing: 'удаляется…' };

/** Без счётчика операций — для вызывающих, которым нечего блокировать (карточка) */
const passThrough = (p) => p;

export function EditableFiles({
  title = null, files, emptyText = null, uploadLabel, canUpload,
  onUpload, onReplace, onRemove, removeMessage, track = passThrough,
  maxBytes = null, caption = null,
}) {
  const [ops, setOps] = useState({});
  const [failed, setFailed] = useState({});
  /**
   * Загрузки этого блока: `uploading` → `uploaded` (строку дальше показывает
   * сам заказ, здесь она только считается в сводке) либо `error`/`tooBig`.
   */
  const [uploads, setUploads] = useState([]);
  const ref = useRef(null);
  const markRemoved = useRemovalFocus(ref);

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
    return ok;
  };

  const startUpload = async (uid, file) => {
    setUploads((u) => u.map((x) => (x.uid === uid ? { ...x, state: 'uploading' } : x)));
    let ok = false;
    try {
      ok = Boolean(await track(onUpload(file)));
    } catch {
      ok = false;
    }
    setUploads((u) => u.map((x) => (x.uid === uid ? { ...x, state: ok ? 'uploaded' : 'error' } : x)));
  };

  const upload = (picked) => {
    const rows = picked.map((file) => ({
      uid: crypto.randomUUID(),
      file,
      state: maxBytes !== null && file.size > maxBytes ? 'tooBig' : 'uploading',
    }));
    setUploads((u) => [...u, ...rows]);
    // Параллельно: каждый файл своей загрузкой, большой в бакет не идёт
    for (const r of rows) if (r.state === 'uploading') startUpload(r.uid, r.file);
  };

  const visibleUploads = uploads.filter((u) => u.state !== 'uploaded');
  const rowIds = [...files.map((f) => f.id), ...visibleUploads.map((u) => u.uid)];

  const remove = async (f) => {
    const ok = await confirm({
      title: 'Удалить файл?',
      message: removeMessage(f),
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (!ok) return;
    const ids = rowIds;
    if (await run(f.id, 'removing', () => onRemove(f), 'не удалён — повторите')) {
      markRemoved(ids, f.id);
    }
  };

  const dropUpload = (uid) => {
    markRemoved(rowIds, uid);
    setUploads((x) => x.filter((y) => y.uid !== uid));
  };

  const replace = (f, file) => run(f.id, 'replacing', () => onReplace(f, file), 'не заменён — повторите');

  const status = [
    batchStatusText(
      uploads.filter((u) => u.state === 'uploaded').length,
      uploads.length,
      uploads.filter((u) => u.state === 'error' || u.state === 'tooBig').length,
    ),
    ...files.filter((f) => ops[f.id]).map((f) => `${f.name}: ${OP_TEXT[ops[f.id]]}`),
  ].filter(Boolean).join(' · ');

  return (
    <div ref={ref} className={styles.attachBlock}>
      <div className={styles.checkRow}>
        {title && <span className={styles.fieldLabel}>{title}</span>}
        {canUpload && (
          <PickButton
            label={uploadLabel}
            ariaLabel={`${uploadLabel}${title ? ` — ${title}` : ''}`}
            variant="secondary"
            multiple
            pickFocus
            onPick={upload}
          />
        )}
        {canUpload && caption && <span className={styles.subText}>{caption}</span>}
      </div>
      <p className={styles.subText} role="status">{status}</p>
      {files.length === 0 && visibleUploads.length === 0 && emptyText && (
        <p className={styles.subText}>{emptyText}</p>
      )}
      {(files.length > 0 || visibleUploads.length > 0) && (
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
                {op && <span className={styles.subText}>{OP_TEXT[op]}</span>}
                {!op && failed[f.id] && <span className={styles.overdue}>{failed[f.id]}</span>}
                {f.canChange && (
                  <>
                    <PickButton
                      label="Заменить"
                      ariaLabel={`Заменить файл ${f.name}`}
                      disabled={Boolean(op)}
                      onPick={(picked) => replace(f, picked[0])}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={Boolean(op)}
                      aria-label={`Удалить файл ${f.name}`}
                      data-row-focus={f.id}
                      onClick={() => remove(f)}
                    >
                      Удалить
                    </Button>
                  </>
                )}
              </li>
            );
          })}
          {visibleUploads.map((u) => (
            <UploadRow
              key={u.uid}
              upload={u}
              maxBytes={maxBytes}
              onRetry={() => startUpload(u.uid, u.file)}
              onDrop={() => dropUpload(u.uid)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Строка файла пачки, ещё не ставшего файлом заказа: грузится, упал или слишком большой */
function UploadRow({ upload: u, maxBytes, onRetry, onDrop }) {
  const name = u.file.name;
  return (
    <li className={styles.attachRow}>
      <Icon name={u.state === 'uploading' ? 'clock' : 'alert'} size={13} />
      <span className={styles.attachName} title={name}>{name}</span>
      {u.state === 'uploading' && <span className={styles.subText}>загружается…</span>}
      {u.state === 'tooBig' && <span className={styles.overdue}>{tooBigText(maxBytes)}</span>}
      {u.state === 'error' && (
        <>
          <span className={styles.overdue}>не загрузился</span>
          <Button variant="ghost" size="sm" aria-label={`Загрузить заново: ${name}`} onClick={onRetry}>
            Загрузить заново
          </Button>
        </>
      )}
      {u.state !== 'uploading' && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Убрать: ${name}`}
          data-row-focus={u.uid}
          onClick={onDrop}
        >
          Убрать
        </Button>
      )}
    </li>
  );
}
