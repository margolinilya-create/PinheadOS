import { useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { messageFullTime } from '../../utils/chatFeed';
import { searchSnippet } from '../../utils/chatSearch';
import styles from '../../styles';

/**
 * ПОИСК ПО ПЕРЕПИСКЕ СДЕЛКИ (вторая очередь чата, документ 20.09, п. 4).
 *
 * СПРАШИВАЕТ СЕРВЕР, А НЕ ФИЛЬТРУЕТ ЛЕНТУ. Лента держит последнюю страницу,
 * а ищут обычно то, что выше неё: локальный фильтр отвечал бы «ничего
 * не найдено» там, где сообщение просто не доехало.
 *
 * НАХОДКА ВЕДЁТ К СООБЩЕНИЮ существующим якорем `?msg=` — тем же, которым
 * ведёт уведомление. Второй способ «попасть в место переписки» означал бы
 * две реализации прокрутки к сообщению.
 *
 * ИЩЕТСЯ ПО ЗАКАЗУ ЦЕЛИКОМ, даже когда окно открыто на контексте задачи:
 * человек ищет «где обсуждали ткань», а не «где обсуждали ткань в этом
 * этапе», — и находка честно показывает, что она из другой задачи.
 */
export function ChatSearch({ orderId, onOpenMessage }) {
  const search = useErpStore((s) => s.searchChat);
  const directory = useErpStore((s) => s.chatDirectory);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [hits, setHits] = useState(null);   // null — ещё не искали
  const [busy, setBusy] = useState(false);

  const nameOf = (id) => directory.find((p) => p.user_id === id)?.name ?? 'Сотрудник';

  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    setHits(await search(orderId, text));
    setBusy(false);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label="Поиск по переписке"
        onClick={() => setOpen(true)}
      >
        <Icon name="search" size={14} />
      </Button>
    );
  }

  return (
    <div className={styles.chatSearch}>
      <form className={styles.chatSearchRow} onSubmit={run}>
        <label className={styles.visuallyHidden} htmlFor={`chat-search-${orderId}`}>
          Поиск по переписке
        </label>
        <input
          id={`chat-search-${orderId}`}
          className={styles.chatSearchInput}
          value={text}
          autoFocus
          placeholder="Найти в переписке"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        />
        {/* Порог в два символа — тот же, что на сервере: по одной букве
            «находится» вся переписка, и это не ответ на вопрос */}
        <Button type="submit" size="sm" variant="primary" disabled={busy || text.trim().length < 2}>
          Найти
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Закрыть поиск"
          onClick={() => { setOpen(false); setHits(null); }}
        >
          <Icon name="x" size={14} />
        </Button>
      </form>

      {hits !== null && (
        hits.length === 0 ? (
          <p className={styles.subText}>Ничего не нашлось</p>
        ) : (
          <ul className={styles.chatSearchList}>
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className={styles.chatSearchHit}
                  onClick={() => {
                    setOpen(false);
                    setHits(null);
                    onOpenMessage(h);
                  }}
                >
                  <span className={styles.chatSearchWho}>
                    {nameOf(h.author_id)}
                    <time className={styles.chatMsgTime} dateTime={h.created_at}>
                      {messageFullTime(h.created_at)}
                    </time>
                  </span>
                  {/* Обрезаем ВОКРУГ найденного: кусок «первые 140 символов»
                      у длинной реплики не содержит того, что искали */}
                  <span className={styles.chatSearchBody}>{searchSnippet(h.body, text)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
