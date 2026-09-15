import { useEffect, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { ChatPanel } from './ChatPanel';
import { unreadForContext } from '../../utils/chatContext';
import styles from '../../styles';

/**
 * ВХОД В ЧАТ С ЛЮБОГО ЭКРАНА, КРОМЕ КАРТОЧКИ ЗАКАЗА.
 *
 * Документ: «на кнопке открытия чата из задачи показывать количество
 * непрочитанных по её контексту». Кнопка РАСКРЫВАЕТ переписку прямо здесь,
 * а не уводит на карточку заказа: человек пришёл на страницу задания
 * работать, и увод с неё ради вопроса «а что с тканью» стоит ему возврата
 * и потерянного места.
 *
 * Счётчик приходит с сервера (`erp_chat_unread`) — ОДНА формула с вкладкой
 * карточки. Вторая, посчитанная на клиенте, разошлась бы, и первым это
 * заметил бы цех: «в сделке непрочитанных нет, а в задаче есть».
 *
 * Компонент один на все входы. Второй такой же рядом означал бы второй
 * ответ на вопрос «что считать прочитанным» — а он в этом проекте уже
 * расходился (две формулы годности материала, §10.1 обхода 04.09).
 */
export function ChatSection({ orderId, context, contextLabel, title = 'Обсуждение' }) {
  const [open, setOpen] = useState(false);
  const unread = useErpStore((s) => s.chatUnread[orderId]);
  const loadChatUnread = useErpStore((s) => s.loadChatUnread);
  const ping = useErpStore((s) => s.chatPing);

  /**
   * Счётчик грузится, даже пока переписка закрыта: он и есть повод её
   * открыть. Перезапрашивается по звонку realtime — иначе число на кнопке
   * оставалось бы вчерашним у вкладки, открытой смену назад.
   */
  useEffect(() => {
    if (orderId) void loadChatUnread(orderId);
  }, [orderId, ping, loadChatUnread]);

  const count = unreadForContext(unread, context);

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <strong>{title}</strong>
        <div className={styles.spacer} />
        <Button
          variant={open ? 'ghost' : 'secondary'}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Icon name="comment" size={14} />
          {open ? 'Свернуть чат' : 'Открыть чат'}
          {count > 0 && !open ? ` · ${count}` : ''}
        </Button>
      </div>
      {open && (
        <ChatPanel orderId={orderId} context={context} contextLabel={contextLabel} />
      )}
    </section>
  );
}
