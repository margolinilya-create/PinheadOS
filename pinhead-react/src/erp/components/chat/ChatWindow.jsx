import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { ChatPanel } from './ChatPanel';
import { ChatNotifyMenu } from './ChatNotifyMenu';
import { ChatSearch } from './ChatSearch';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import styles from '../../styles';

/**
 * ОКНО ЧАТА ПОВЕРХ ERP (правка заказчика 20.09, п. 4).
 *
 * «На компьютере открывать чат в отдельном окне поверх ERP шириной примерно
 * 760–960 px, с возможностью развернуть. В шапке: номер и название заказа,
 * фильтр „Весь заказ / Контекст", поиск, настройки уведомлений, свернуть
 * или закрыть».
 *
 * ПОЧЕМУ НЕ `Drawer`. Тот модальный: `aria-modal`, оверлей, фокус заперт —
 * и это правильно для формы, которую надо закончить. Здесь наоборот: чат
 * открывают, ЧТОБЫ РАБОТАТЬ ДАЛЬШЕ, глядя в переписку. Оверлей поверх
 * очереди цеха сделал бы ровно то, от чего окно и спасает.
 *
 * ПОЧЕМУ МОНТИРУЕТСЯ В ОБОЛОЧКЕ, а не в карточке заказа: окно переживает
 * переход между разделами. Смонтируй мы его в экране — переход на «Задания»
 * закрывал бы разговор, и «окно поверх» превратилось бы во вкладку
 * с лишними рамками.
 *
 * ФОКУС НЕ ЗАПИРАЕМ, но Escape закрывает: `useFocusTrap` здесь вызывается
 * с выключенной ловушкой — он остаётся ради одного Escape, чтобы не заводить
 * второй обработчик клавиатуры рядом с существующим.
 */
export function ChatWindow() {
  const { win, close, toggleSize } = useErpStore(useShallow((s) => ({
    win: s.chatWindow,
    close: s.closeChatWindow,
    toggleSize: s.toggleChatWindowSize,
  })));

  const ref = useFocusTrap(false, close);
  /**
   * Куда прокрутить ленту после находки. Состояние ОКНА, а не стора: это
   * разовое «покажи вот это сообщение», и в сторе оно пережило бы закрытие
   * окна, уведя человека к чужой находке при следующем открытии.
   */
  const [focusId, setFocusId] = useState(null);

  if (!win) return null;

  return (
    <section
      ref={ref}
      className={`${styles.chatFloat} ${win.expanded ? styles.chatFloatWide : ''}`}
      role="dialog"
      aria-label={`Чат заказа ${win.title}`}
    >
      <header className={styles.chatFloatHead}>
        <span className={styles.chatFloatTitle} title={win.title}>{win.title}</span>

        {/* Поиск по переписке (вторая очередь): ищет СЕРВЕР по всей сделке,
            и находка ведёт к сообщению тем же якорем, что уведомление */}
        <ChatSearch orderId={win.orderId} onOpenMessage={(hit) => setFocusId(hit.id)} />

        {/* Настройки уведомлений — по заказу, как просит документ: режим
            выбирают «на заказ», а не на сообщение и не глобально */}
        <ChatNotifyMenu orderId={win.orderId} />

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSize}
          aria-label={win.expanded ? 'Свернуть окно чата' : 'Развернуть окно чата'}
        >
          {/* Стрелки, а не «развернуть/свернуть»: своих иконок окна
              в наборе нет, а заводить их ради двух состояний незачем */}
          <Icon name={win.expanded ? 'arrowDown' : 'arrowUp'} size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={close} aria-label="Закрыть чат">
          <Icon name="x" size={14} />
        </Button>
      </header>

      {/* Лента и переключатель «Весь заказ / Контекст» — те же, что
          на вкладке карточки: второй реализации переписки в проекте нет */}
      <ChatPanel
        orderId={win.orderId}
        context={win.context}
        contextLabel={win.contextLabel}
        focusId={focusId}
      />
    </section>
  );
}
