import { useState } from 'react';
import useWorkshopStore from '../../store/useWorkshopStore';
import styles from '../TaskDetail.module.css';

const EVENT_ICONS = { started: '▶', completed: '✓', blocked: '⚠', comment: '💬', unblocked: '✓', photo: '📷' };

function EventLog({ taskId }) {
  const events = useWorkshopStore(s => s.events[taskId] || []);
  if (!events.length) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>История</div>
      <div className={styles.events}>
        {events.map(evt => (
          <div key={evt.id} className={styles.event}>
            <span className={styles.eventIcon}>{EVENT_ICONS[evt.type] || '•'}</span>
            <span className={styles.eventText}>{evt.text}</span>
            <span className={styles.eventTime}>{new Date(evt.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TaskDetailComments({ taskId }) {
  const [text, setText] = useState('');
  const comments = useWorkshopStore(s => s.comments[taskId] || []);
  const addComment = useWorkshopStore(s => s.addComment);

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    addComment(taskId, text);
    setText('');
  }

  return (
    <>
      <EventLog taskId={taskId} />

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Комментарии {comments.length > 0 && `(${comments.length})`}</div>
        {comments.length > 0 && (
          <div className={styles.comments}>
            {comments.map(c => (
              <div key={c.id} className={styles.comment}>
                <div className={styles.commentHeader}>
                  <span className={styles.commentAuthor}>{c.author}</span>
                  <span className={styles.commentTime}>{new Date(c.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className={styles.commentText}>{c.text}</div>
              </div>
            ))}
          </div>
        )}
        <form className={styles.commentForm} onSubmit={handleSubmit}>
          <input
            className={styles.commentInput}
            placeholder="Написать комментарий..."
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <button type="submit" className={styles.commentSend} disabled={!text.trim()}>→</button>
        </form>
      </div>
    </>
  );
}
