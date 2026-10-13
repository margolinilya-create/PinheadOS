import { useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { messageFullTime } from '../../utils/chatFeed';
import styles from '../../styles';

/**
 * «ПРОЧИТАЛИ N» У СВОЕГО СООБЩЕНИЯ (правка заказчика 20.09, п. 4).
 *
 * «После прочтения другим сотрудником показывать „Прочитали N". По нажатию —
 * имена и время прочтения. Сам автор не учитывается. Если ещё никто
 * не прочитал — остаётся „Отправлено"».
 *
 * «ПРОЧИТАЛИ ВСЕ» НЕ ПИШЕМ — прямой запрет документа: «не писать „Прочитали
 * все" для чата, доступного всей компании: у него нет фиксированного состава
 * читателей». Переписку сделки видит каждый участник ERP, и «все» означало бы
 * число, которого никто не считал.
 *
 * СПИСОК ЧИТАТЕЛЕЙ ГРУЗИТСЯ ПО НАЖАТИЮ, а не вместе с лентой: имена нужны
 * ровно тогда, когда на счётчик нажали, а страница ленты — это полсотни
 * сообщений, каждое со своим списком.
 */
export function ChatReadReceipts({ messageId, count }) {
  const load = useErpStore((s) => s.loadChatReadReceipts);
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);

  if (!(count > 0)) {
    // Никто ещё не прочитал — «Отправлено», как просит документ
    return <span className={styles.chatReceipt}>Отправлено</span>;
  }

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null) setRows(await load([messageId]));
  };

  return (
    <span className={styles.chatReceiptWrap}>
      <button
        type="button"
        className={styles.chatReceipt}
        onClick={toggle}
        aria-expanded={open}
      >
        Прочитали {count}
      </button>
      {open && (
        <ul className={styles.chatReceiptList}>
          {rows === null && <li className={styles.subText}>загружаем…</li>}
          {rows?.length === 0 && <li className={styles.subText}>никого</li>}
          {rows?.map((r) => (
            <li key={r.user_id}>
              {r.name || 'Сотрудник'}
              {' · '}
              <span className={styles.subText}>{messageFullTime(r.read_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
