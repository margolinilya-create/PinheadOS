import { useRef, useState } from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { useAttachmentUploads } from '../../hooks/useAttachmentUploads';
import { useChatDraft } from '../../hooks/useChatDraft';
import { createAttemptKeeper } from '../../utils/attemptKey';
import {
  applyMention, matchPeople, mentionQuery, mentionsInText,
} from '../../utils/mentions';
import { MentionPicker } from './MentionPicker';
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
export function ChatComposer({
  orderId, context, replyTo, onCancelReply, onSend, nameOf, directory = [],
}) {
  const [text, setText, resetDraft] = useChatDraft(orderId, context);
  const [saving, setSaving] = useState(false);
  const uploads = useAttachmentUploads('chat');
  const keeper = useRef(createAttemptKeeper());
  const inputRef = useRef(null);

  /**
   * ВЫБРАННЫЕ адресаты. Именно выбранные, а не разобранные из текста:
   * «просто введённый текст „@Имя" без выбора сотрудника из списка
   * не считается упоминанием» (документ). Список копится за время набора,
   * а перед отправкой отсеивается по тексту — стёр `@Имя`, значит
   * не зовёт.
   */
  const [chosen, setChosen] = useState([]);
  const [mention, setMention] = useState(null);
  const [mentionAt, setMentionAt] = useState(0);
  /** Файл тащат над полем — подсветка зоны приёма (правка 20.09, п. 4) */
  const [dragOver, setDragOver] = useState(false);
  const suggestions = mention ? matchPeople(directory, mention.query) : [];

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
      mentionsInText(text, chosen),
    ]);
    const clientKey = keeper.current.keyFor(signature);
    setSaving(true);
    try {
      const ok = await onSend({
        body: text.trim(),
        clientKey,
        replyTo: replyTo?.id ?? null,
        mentions: mentionsInText(text, chosen),
        attachments: ready.map((f) => ({ file_path: f.path, file_name: f.name })),
      });
      if (!ok) return;
      keeper.current.reset();
      resetDraft();
      setChosen([]);
      setMention(null);
      // Файлы забываются БЕЗ удаления объектов: у них появился владелец —
      // строка вложения отправленного сообщения
      uploads.clear();
      onCancelReply?.();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Подстановка выбранного. Человек попадает в `chosen` — это и есть
   * «выбрал из списка»; сам токен в тексте он потом волен стереть,
   * и тогда `mentionsInText` его отсеет.
   */
  function pickMention(person) {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? text.length;
    const next = applyMention(text, mention.from, caret, person);
    setText(next.text);
    setChosen((list) => (list.some((p) => p.user_id === person.user_id)
      ? list
      : [...list, { user_id: person.user_id, name: person.name }]));
    setMention(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(next.caret, next.caret);
    });
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
        className={`${styles.chatComposerRow} ${dragOver ? styles.chatDropActive : ''}`}
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        /*
          ПЕРЕТАСКИВАНИЕ (правка 20.09, п. 4). Подсветка нужна не для красоты:
          без неё человек не знает, отпускать ли файл здесь, и роняет его
          мимо окна — браузер тогда ОТКРЫВАЕТ файл вместо загрузки, теряя
          набранный текст вместе со страницей.
        */
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          for (const file of e.dataTransfer?.files ?? []) uploads.add(file, 'chat');
        }}
      >
        <label className={styles.chatAttachBtn}>
          <Icon name="paperclip" size={16} />
          <span className={styles.visuallyHidden}>Приложить файл</span>
          {/*
            НЕСКОЛЬКО ФАЙЛОВ СРАЗУ (правка 20.09, п. 4): «разрешить несколько
            вложений, перетаскивание и вставку изображения из буфера».
            Прежде input был без `multiple`, и приложить три фотографии
            означало три захода в диалог выбора.
          */}
          <input
            type="file"
            hidden
            multiple
            onChange={(e) => {
              for (const file of e.target.files ?? []) uploads.add(file, 'chat');
              e.target.value = '';
            }}
          />
        </label>
        <div className={styles.chatInputWrap}>
          {mention && (
            <MentionPicker
              people={suggestions}
              activeIndex={mentionAt}
              onPick={pickMention}
              emptyHint={
                directory.length === 0
                  ? 'Справочник сотрудников ещё не загрузился'
                  : 'Никого не нашли. Упомянуть можно только того, у кого есть доступ в систему'
              }
            />
          )}
          <textarea
            ref={inputRef}
            className={styles.chatInput}
            value={text}
            rows={2}
            placeholder="Сообщение для производства… @ — упомянуть"
            aria-label="Новое сообщение"
            onChange={(e) => {
              setText(e.target.value);
              const found = mentionQuery(e.target.value, e.target.selectionStart ?? 0);
              setMention(found);
              setMentionAt(0);
            }}
            onBlur={() => setMention(null)}
            /*
              ВСТАВКА ИЗ БУФЕРА (правка 20.09, п. 4) — скриншот брака делают
              «Ctrl+Shift+S», и путь «сохранить на диск → найти → приложить»
              здесь лишний целиком.

              Текстовую вставку не трогаем: `items` с файлами есть только
              у картинок и файлов, у обычного текста список пуст.
            */
            onPaste={(e) => {
              const files = [...(e.clipboardData?.items ?? [])]
                .filter((it) => it.kind === 'file')
                .map((it) => it.getAsFile())
                .filter(Boolean);
              if (files.length === 0) return;
              e.preventDefault();
              for (const file of files) uploads.add(file, 'chat');
            }}
            onKeyDown={(e) => {
              if (mention && suggestions.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const step = e.key === 'ArrowDown' ? 1 : -1;
                  const next = (mentionAt + step + suggestions.length) % suggestions.length;
                  setMentionAt(next);
                  return;
                }
                /**
                 * Enter при открытой подсказке ПОДСТАВЛЯЕТ, а не отправляет:
                 * иначе половина набранного упоминания уезжала бы в ленту
                 * ровно в тот момент, когда человек выбирает человека.
                 */
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  pickMention(suggestions[mentionAt]);
                  return;
                }
              }
              if (e.key === 'Escape' && mention) {
                e.preventDefault();
                setMention(null);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <Button variant="primary" type="submit" disabled={!canSend}>
          {saving ? 'Отправка…' : 'Отправить'}
        </Button>
      </form>
    </div>
  );
}
