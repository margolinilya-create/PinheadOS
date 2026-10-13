import { useEffect } from 'react';
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
export function ChatSection({
  orderId, context, contextLabel, title = 'Обсуждение', windowTitle,
}) {
  const openWindow = useErpStore((s) => s.openChatWindow);
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
        {/*
          ЧАТ ОТКРЫВАЕТСЯ ОКНОМ ПОВЕРХ ERP (правка 20.09, п. 4), а не
          раскрывается на месте. Раскрытая лента внутри страницы задания
          уводила вниз всё остальное — маршрут, файлы, комментарии, — и,
          чтобы ответить в переписке, приходилось терять из виду задание,
          ради которого чат и открывают.
        */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openWindow(orderId, windowTitle, context, contextLabel)}
        >
          <Icon name="comment" size={14} />
          Открыть чат
          {count > 0 ? ` · ${count}` : ''}
        </Button>
      </div>
    </section>
  );
}
