import { useRef, useState } from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { useAttachmentUploads } from '../../hooks/useAttachmentUploads';
import { useChatDraft } from '../../hooks/useChatDraft';
import { createAttemptKeeper } from '../../utils/attemptKey';
import styles from '../../styles';

/**
 * Поле отправки сообщения.
 *
 * ТРИ ПРАВИЛА ПРОЕКТА СХОДЯТСЯ ЗДЕСЬ:
 *
 * 1. ФАЙЛ УХОДИТ В БАКЕТ ПРИ ВЫБОРЕ (`useAttachmentUploads`), а не в момент
 *    отправки: иначе форма показывает приложенным то, чего в Storage нет.
 *    Отправка заблокирована, пока есть незавершённые загрузки.
 * 2. КЛЮЧ ПОПЫТКИ (`utils/attemptKey`) — «не изменил ввод, значит та же
 *    попытка». Ответ оборвался, человек нажал «Отправить» второй раз —
 *    сервер вернёт то же сообщение, а не заведёт второе. `saving` от этого
 *    не спасает: он гасит кнопку на время ОДНОГО запроса.
 * 3. ЧЕРНОВИК ПЕРЕЖИВАЕТ ЗАКРЫТИЕ ОКНА (`useChatDraft`) — прямое требование
 *    документа.
 *
 * `Enter` отправляет, `Shift+Enter` переносит строку: чат набирают быстро,
 * и кнопка мышью на каждую реплику — это ровно то, на что жалуются.
 */
export function ChatComposer({ orderId, context, replyTo, onCancelReply, onSend, nameOf }) {
  const [text, setText, resetDraft] = useChatDraft(orderId, context);
  const [saving, setSaving] = useState(false);
  const uploads = useAttachmentUploads('chat');
  const keeper = useRef(createAttemptKeeper());

  const ready = uploads.files.filter((f) => f.state === 'uploaded');
  const canSend = (text.trim() || ready.length > 0) && !uploads.uploading && !saving;

  async function submit() {
    if (!canSend) return;
    /**
     * Подпись попытки включает и текст, и файлы, и то, на что отвечаем:
     * поменял человек хоть что-то — это НОВОЕ сообщение, и ключ обязан
     * смениться, иначе сервер вернёт прежнее и правка потеряется молча.
     */
    const signature = JSON.stringify([
      text.trim(), replyTo?.id ?? null, ready.map((f) => f.path),
    ]);
    const clientKey = keeper.current.keyFor(signature);
    setSaving(true);
    try {
      const ok = await onSend({
        body: text.trim(),
        clientKey,
        replyTo: replyTo?.id ?? null,
        attachments: ready.map((f) => ({ file_path: f.path, file_name: f.name })),
      });
      if (!ok) return;
      keeper.current.reset();
      resetDraft();
      // Файлы забываются БЕЗ удаления объектов: у них появился владелец —
      // строка вложения отправленного сообщения
      uploads.clear();
      onCancelReply?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.chatComposer}>
      {replyTo && (
        <div className={styles.chatReplyBar}>
          <span className={styles.chatReplyText}>
            Ответ <strong>{nameOf(replyTo.author_id)}</strong>: {replyTo.body.slice(0, 80)}
          </span>
          <button
            type="button"
            className={styles.chatReplyCancel}
            onClick={onCancelReply}
            aria-label="Отменить ответ"
          >
            ✕
          </button>
        </div>
      )}

      {uploads.files.length > 0 && (
        <ul className={styles.chatUploads}>
          {uploads.files.map((f) => (
            <li key={f.uid} className={styles.chatUpload}>
              <span>{f.name}</span>
              {f.state === 'uploading' && <span className={styles.subText}>загружается…</span>}
              {f.state === 'error' && (
                <>
                  <span className={styles.chatUploadError}>{f.error}</span>
                  <button type="button" onClick={() => uploads.retry(f.uid)}>Повторить</button>
                </>
              )}
              <button
                type="button"
                onClick={() => uploads.remove(f.uid)}
                aria-label={`Убрать файл ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.chatComposerRow}
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <label className={styles.chatAttachBtn}>
          <Icon name="paperclip" size={16} />
          <span className={styles.visuallyHidden}>Приложить файл</span>
          <input
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploads.add(file, 'chat');
              e.target.value = '';
            }}
          />
        </label>
        <textarea
          className={styles.chatInput}
          value={text}
          rows={2}
          placeholder="Сообщение для производства…"
          aria-label="Новое сообщение"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button variant="primary" type="submit" disabled={!canSend}>
          {saving ? 'Отправка…' : 'Отправить'}
        </Button>
      </form>
    </div>
  );
}
