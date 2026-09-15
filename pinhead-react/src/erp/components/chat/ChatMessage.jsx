import { supabase } from '../../../lib/supabase';
import { Icon } from '../Icon';
import styles from '../../styles';
import { formatDateTimeShort } from '../../utils/format';
import { splitMentions } from '../../utils/mentions';

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

export function ChatMessage({ message, nameOf, meId, onReply, highlighted, directory = [] }) {
  const mine = message.author_id === meId;
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
      aria-label={`Сообщение от ${nameOf(message.author_id)}`}
    >
      <header className={styles.chatMsgHead}>
        <strong className={styles.chatMsgAuthor}>{nameOf(message.author_id)}</strong>
        <time className={styles.chatMsgTime} dateTime={message.created_at}>
          {formatDateTimeShort(message.created_at)}
        </time>
        {/* «Вас упомянули» видно В ЛЕНТЕ, а не только в колоколе: человек
            приходит по ссылке и должен понять, ради чего его позвали */}
        {mentioned && <span className={styles.chatMsgMention}>вам</span>}
        {onReply && (
          <button
            type="button"
            className={styles.chatMsgReply}
            onClick={() => onReply(message)}
          >
            Ответить
          </button>
        )}
      </header>

      {message.reply && (
        /* Цитата приезжает с сервера обрезанной: искать исходное сообщение
           в выгруженной ленте нельзя — оно может быть выше страницы */
        <a className={styles.chatQuote} href={`#chat-msg-${message.reply.id}`}>
          <span className={styles.chatQuoteAuthor}>{nameOf(message.reply.author_id)}</span>
          <span className={styles.chatQuoteBody}>{message.reply.body}</span>
        </a>
      )}

      {message.body && (
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

      {message.attachments?.length > 0 && (
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
