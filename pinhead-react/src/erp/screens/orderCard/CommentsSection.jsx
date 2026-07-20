import { useState } from 'react';
import { Skeleton } from '../../../components/shared/Skeleton';
import styles from '../../erp.module.css';
import { fmtTs } from './format';

/**
 * Секция комментариев заказа: список + форма отправки.
 * onSend(text) отправляет комментарий и возвращает созданную строку (или null);
 * список comments приходит из родителя (там же обновляется realtime-подпиской).
 */
export function CommentsSection({ comments, onSend }) {
  const [draft, setDraft] = useState('');

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}><strong>Комментарии</strong></div>
      <div className={styles.commentList}>
        {comments === null && <Skeleton width="45%" height={12} />}
        {comments && comments.length === 0 && (
          <div className={styles.subText}>Пока пусто — обсуждайте заказ прямо здесь.</div>
        )}
        {comments && comments.map((c) => (
          <div key={c.id} className={styles.commentItem}>
            <div className={styles.commentMeta}>{c.author} · {fmtTs(c.created_at)}</div>
            {c.text}
          </div>
        ))}
      </div>
      <form
        className={styles.commentForm}
        onSubmit={async (e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text) return;
          const row = await onSend(text);
          if (row) setDraft('');
        }}
      >
        <input
          className={styles.input}
          placeholder="Комментарий для производства…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Новый комментарий"
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
          Отправить
        </button>
      </form>
    </section>
  );
}
