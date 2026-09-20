import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { Icon } from '../components/Icon';
import styles from '../erp.module.css';

/**
 * ВСПЛЫВАЮЩИЕ УВЕДОМЛЕНИЯ (правка заказчика 20.09, п. 4).
 *
 * «Обязательный минимум — уведомления внутри ERP в реальном времени:
 * глобальная кнопка с бейджем, центр уведомлений и всплывающие уведомления».
 *
 * ПОЧЕМУ НЕ ОБЩИЙ ТОСТ. `useToastStore` показывает РЕЗУЛЬТАТ ДЕЙСТВИЯ того,
 * кто сейчас нажал: сообщение без адреса, гаснущее само. Здесь другое —
 * событие с адресатом, по которому надо уметь перейти, и переход должен
 * вести к самому сообщению. Расширять общий тост ссылками ради одного
 * случая значило бы усложнить то, чем пользуется весь портал.
 *
 * ЧТО РЕШАЕТ НЕ ЭТОТ ФАЙЛ: «что из пришедшего новое» считает слайс
 * (`utils/noticePopups`) — разметка не должна знать правило «первая загрузка
 * молчит», иначе его не проверить и легко потерять при правке оболочки.
 */

/** Сколько карточка висит, если её не трогают */
export const POPUP_TTL_MS = 8000;

function Popup({ notice, onOpen, onClose }) {
  /**
   * Таймер живёт у КАРТОЧКИ, а не у списка: у каждой свой отсчёт, и вторая
   * пришедшая не должна ни продлевать, ни укорачивать жизнь первой.
   */
  useEffect(() => {
    const t = setTimeout(() => onClose(notice.id), POPUP_TTL_MS);
    return () => clearTimeout(t);
  }, [notice.id, onClose]);

  return (
    <div className={styles.noticePopup}>
      <button
        type="button"
        className={styles.noticePopupBody}
        onClick={() => onOpen(notice)}
      >
        <span className={styles.noticeTitle}>{notice.title}</span>
        {notice.body && <span className={styles.subText}>{notice.body}</span>}
      </button>
      <button
        type="button"
        className={styles.noticePopupClose}
        aria-label="Закрыть уведомление"
        onClick={() => onClose(notice.id)}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export function NoticePopups() {
  const navigate = useNavigate();
  const { popups, dismiss, markRead, win } = useErpStore(useShallow((s) => ({
    popups: s.noticePopups,
    dismiss: s.dismissNoticePopup,
    markRead: s.markNotificationsRead,
    win: s.chatWindow,
  })));

  /**
   * ПО ОТКРЫТОМУ ЗАКАЗУ НЕ ВСПЛЫВАЕМ: если окно чата этого заказа уже
   * открыто, человек читает переписку прямо сейчас, и карточка поверх неё
   * сообщала бы о том, что у него перед глазами. Само уведомление при этом
   * остаётся в центре — гасить его за человека нельзя.
   */
  const list = popups.filter((n) => !(win && n.order_id === win.orderId));
  if (list.length === 0) return null;

  return (
    <div className={styles.noticePopups} role="status" aria-label="Новые уведомления">
      {list.map((n) => (
        <Popup
          key={n.id}
          notice={n}
          onClose={dismiss}
          onOpen={(notice) => {
            /**
             * Переход ведёт К СООБЩЕНИЮ (ссылка несёт `?tab=chat&msg=…`),
             * а уведомление гасится: человек идёт читать, и оставлять его
             * непрочитанным значит просить прочитать дважды. Сам ТЕКСТ
             * прочитанным при этом не считается — это решает видимая
             * область ленты (документ разводит их прямо).
             */
            void markRead([notice.id]);
            if (notice.link) navigate(notice.link);
            dismiss(notice.id);
          }}
        />
      ))}
    </div>
  );
}
