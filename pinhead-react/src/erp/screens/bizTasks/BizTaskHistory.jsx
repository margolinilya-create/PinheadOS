import { useId } from 'react';
import { eventText, formatMoment } from './bizTaskCardView';
import styles from './BizTaskCard.module.css';

/**
 * ИСТОРИЯ ЗАДАЧИ (правки 19.10, п. 7, «Файлы и история»): создание, начало,
 * смена ответственного, срока и участников, приостановка, сдача, проверка,
 * возврат, завершение, отмена, правки результата и чек-листа.
 *
 * Системные события ОТДЕЛЕНЫ от сообщений: своя область «История», а не
 * строки ленты диалога. Читаются сверху вниз в порядке времени — история
 * отвечает на «как задача пришла к нынешнему виду». Автор `null` —
 * напоминание системы о сроке (или профиль удалён).
 */
export function BizTaskHistory({ events, names }) {
  const headId = useId();
  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h2 id={headId} className={styles.blockTitle}>История</h2>
      {events.length === 0 ? (
        <p className={styles.muted}>Событий пока нет.</p>
      ) : (
        <ol className={styles.events}>
          {events.map((e) => (
            <li key={e.id} className={styles.event}>
              <span className={styles.eventMeta}>
                <time dateTime={e.at}>{formatMoment(e.at)}</time>{' '}
                <span>{e.actor ? names.get(e.actor) ?? '—' : 'Система'}</span>
              </span>
              <span>{eventText(e, names)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
