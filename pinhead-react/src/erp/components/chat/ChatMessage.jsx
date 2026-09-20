import { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { confirm } from '../../../store/useConfirmStore';
import { Icon } from '../Icon';
import { Button } from '../Button';
import styles from '../../styles';
import { messageTime, messageFullTime } from '../../utils/chatFeed';
import { splitMentions, mentionsInText } from '../../utils/mentions';
import { ChatReadReceipts } from './ChatReadReceipts';

/**
 * Одно сообщение переписки.
 *
 * АВТОР НАЗЫВАЕТСЯ ПО СПРАВОЧНИКУ, а не по полю сообщения: в базе лежит
 * постоянный `author_id`, и подпись резолвится при отрисовке. Тогда
 * переименование сотрудника меняет её во всей ленте разом — ровно это
 * и требует документ («изменение имени или email не должно нарушать привязку
 * сообщений, упоминаний и уведомлений»).
 *
 * Имя неизвестно — пишем «Сотрудник», а не пустоту: человек, вышедший
 * из системы или заведённый после загрузки справочника, всё равно автор,
 * и безымянная строка читалась бы как поломка.
 */

function fileUrl(path) {
  return supabase.storage.from('erp-attachments').getPublicUrl(path).data.publicUrl;
}

const isImage = (att) => /\.(png|jpe?g|webp|gif|avif)$/i.test(att.file_name || att.file_path);

export function ChatMessage({
  message, nameOf, meId, onReply, highlighted, directory = [],
  /**
   * Правка и удаление СВОЕГО сообщения (вторая очередь чата). Приходят
   * из панели, а не берутся из стора здесь: одно сообщение — показ,
   * а кто и как пишет, решает единственная реализация ленты.
   */
  onEdit, onDelete,
  /**
   * Продолжение группы (правка 20.09, п. 4): имя автора уже стоит над
   * группой, и повторять его у каждой реплики — ровно то, что документ
   * просит «объединить визуально». Время остаётся у каждого сообщения:
   * оно у них разное.
   */
  compact = false,
  /**
   * Наблюдатель прочтения (правка 20.09, п. 4): вешается на КАЖДЫЙ пузырь,
   * потому что прочитанным считается сообщение, а не лента.
   */
  observeRef,
}) {
  const mine = message.author_id === meId;
  const deleted = Boolean(message.deleted_at);
  const [draft, setDraft] = useState(null);   // null — правка не открыта
  const [busy, setBusy] = useState(false);
  const mentioned = Array.isArray(message.mentions) && meId
    ? message.mentions.includes(meId)
    : false;

  return (
    <article
      className={[
        styles.chatMsg,
        mine ? styles.chatMsgMine : '',
        highlighted ? styles.chatMsgFocus : '',
      ].filter(Boolean).join(' ')}
      id={`chat-msg-${message.id}`}
      ref={observeRef}
      data-message-id={message.id}
      aria-label={`Сообщение от ${nameOf(message.author_id)}`}
    >
      <header className={styles.chatMsgHead}>
        {!compact && (
          <strong className={styles.chatMsgAuthor}>{nameOf(message.author_id)}</strong>
        )}
        {/* Время — ЧЧ:ММ по поясу фабрики; полная дата в подсказке
            (документ: «полная дата и время доступны по наведению») */}
        <time
          className={styles.chatMsgTime}
          dateTime={message.created_at}
          title={messageFullTime(message.created_at)}
        >
          {messageTime(message.created_at)}
        </time>
        {/* «Вас упомянули» видно В ЛЕНТЕ, а не только в колоколе: человек
            приходит по ссылке и должен понять, ради чего его позвали */}
        {mentioned && <span className={styles.chatMsgMention}>вам</span>}
        {/* «изменено» — рядом со временем, а не вместо него: важен и момент
            отправки, и факт правки (полная дата правки — в подсказке) */}
        {message.edited_at && !deleted && (
          <span className={styles.chatMsgEdited} title={messageFullTime(message.edited_at)}>
            изменено
          </span>
        )}
        {/* ДЕЙСТВИЯ СООБЩЕНИЯ — одной группой у правого края. Порознь
            каждая кнопка с `margin-left: auto` растаскивала бы соседей
            по всей ширине шапки. */}
        <div className={styles.chatMsgActions}>
          {onReply && !deleted && (
            <button
              type="button"
              className={styles.chatMsgReply}
              onClick={() => onReply(message)}
            >
              Ответить
            </button>
          )}
          {/* Правка и удаление — только у своего и только пока оно живо.
              Отдельного меню нет: два действия прячутся в меню ровно
              настолько, насколько усложняют до них добраться */}
          {mine && !deleted && onEdit && draft === null && (
            <button
              type="button"
              className={styles.chatMsgReply}
              onClick={() => setDraft(message.body)}
            >
              Изменить
            </button>
          )}
          {mine && !deleted && onDelete && (
            <button
              type="button"
              className={styles.chatMsgReply}
              onClick={async () => {
                /**
                 * Подтверждение обязательно: удаление необратимо и затирает
                 * текст на сервере — «отменить» после него нечем.
                 */
                const ok = await confirm({
                  title: 'Удалить сообщение?',
                  message: 'Текст будет удалён навсегда, вместе с файлами этого сообщения. В переписке останется пометка «Сообщение удалено».',
                  confirmLabel: 'Удалить',
                  variant: 'danger',
                });
                if (ok) await onDelete(message);
              }}
            >
              Удалить
            </button>
          )}
        </div>
      </header>

      {message.reply && (
        /* Цитата приезжает с сервера обрезанной: искать исходное сообщение
           в выгруженной ленте нельзя — оно может быть выше страницы */
        <a className={styles.chatQuote} href={`#chat-msg-${message.reply.id}`}>
          <span className={styles.chatQuoteAuthor}>{nameOf(message.reply.author_id)}</span>
          {/* Тело удалённого затёрто СЕРВЕРОМ — без этой ветки здесь была бы
              пустая полоска вместо ответа на понятный вопрос «а на что это» */}
          <span className={styles.chatQuoteBody}>
            {message.reply.deleted ? 'Сообщение удалено' : message.reply.body}
          </span>
        </a>
      )}

      {deleted && (
        <p className={`${styles.chatMsgBody} ${styles.chatMsgDeleted}`}>Сообщение удалено</p>
      )}

      {draft !== null && (
        /**
         * ПРАВКА ИДЁТ НА МЕСТЕ СООБЩЕНИЯ, а не в поле отправки внизу:
         * человек правит то, что видит, и ему важно видеть соседние реплики,
         * ради которых он текст и меняет.
         */
        <form
          className={styles.chatEdit}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            /**
             * Упоминания правка может СНЯТЬ, но не добавить: снятое видно
             * по исчезнувшему токену, а новое некому доставить — уведомлений
             * правка намеренно не шлёт (иначе правкой текста можно звать
             * людей сколько угодно раз). Позвать кого-то ещё — это новое
             * сообщение.
             */
            const kept = mentionsInText(
              draft,
              directory.filter((p) => (message.mentions ?? []).includes(p.user_id)),
            );
            const ok = await onEdit(message, draft, kept);
            setBusy(false);
            if (ok) setDraft(null);
          }}
        >
          <label className={styles.visuallyHidden} htmlFor={`chat-edit-${message.id}`}>
            Текст сообщения
          </label>
          <textarea
            id={`chat-edit-${message.id}`}
            className={styles.chatEditArea}
            value={draft}
            rows={2}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }}
          />
          <div className={styles.chatEditRow}>
            <Button type="submit" size="sm" variant="primary" disabled={busy}>
              Сохранить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {message.body && !deleted && draft === null && (
        <p className={styles.chatMsgBody}>
          {/* Подсвечиваются ТОЛЬКО настоящие адресаты сообщения: подсветка
              любого `@слова` обещала бы, что человека позвали */}
          {splitMentions(message.body, message.mentions ?? [], directory).map((part, i) => (
            part.mention
              ? <mark key={i} className={styles.chatMention}>{part.text}</mark>
              : <span key={i}>{part.text}</span>
          ))}
        </p>
      )}

      {/*
        «ПРОЧИТАЛИ N» — ТОЛЬКО У СВОИХ сообщений (правка 20.09, п. 4):
        отправитель спрашивает «дошло ли», а у чужого сообщения этот вопрос
        не имеет смысла и лишь удваивал бы каждую строку ленты.
      */}
      {mine && (
        <ChatReadReceipts messageId={message.id} count={message.read_count ?? 0} />
      )}

      {message.attachments?.length > 0 && !deleted && (
        <ul className={styles.chatFiles}>
          {message.attachments.map((att) => (
            <li key={att.id}>
              <a
                href={fileUrl(att.file_path)}
                target="_blank"
                rel="noreferrer"
                className={styles.chatFile}
              >
                {isImage(att) ? (
                  <img
                    src={fileUrl(att.file_path)}
                    alt={att.file_name || 'вложение'}
                    className={styles.chatFileThumb}
                    loading="lazy"
                  />
                ) : (
                  <Icon name="orders" size={16} />
                )}
                <span>{att.file_name || 'файл'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
