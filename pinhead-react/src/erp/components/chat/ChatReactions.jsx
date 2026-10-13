import { useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Icon } from '../Icon';
import { REACTION_CHOICES } from '../../utils/chatReactions';
import styles from '../../styles';

/**
 * РЕАКЦИИ НА СООБЩЕНИЕ (вторая очередь чата, документ 20.09, п. 4).
 *
 * НАБОР ЗАДАЁТ КЛИЕНТ, а не база: список «какие лица предлагать» меняется
 * от привычек людей, а CHECK на него означал бы миграцию на каждое новое.
 * Сервер ограничивает только длину — реакция не должна оказаться сообщением.
 *
 * ПОКАЗЫВАЮТСЯ ТОЛЬКО ПОСТАВЛЕННЫЕ. Полоска из шести серых лиц под каждой
 * репликой — это шесть предложений нажать на то, что никому не нужно; набор
 * открывается по кнопке и только у живого сообщения.
 *
 * СЧИТАЕТ СЕРВЕР. Сводка `{emoji, count, mine}` приезжает вместе с лентой,
 * а нажатие переключает реакцию одним вызовом: клиент не знает наверняка,
 * стоит ли уже его, — лента могла устареть на секунду.
 *
 * Сам набор — в `utils/chatReactions`: файл с компонентом И константой
 * ломает горячую перезагрузку.
 */

export function ChatReactions({ messageId, reactions = [], disabled = false }) {
  const toggle = useErpStore((s) => s.toggleChatReaction);
  const loadPeople = useErpStore((s) => s.loadChatReactionPeople);
  const [picking, setPicking] = useState(false);
  const [people, setPeople] = useState(null);

  const list = reactions.filter((r) => r.count > 0);
  if (disabled && list.length === 0) return null;

  /** Кто поставил — по наведению на счётчик, одним вызовом на сообщение */
  const showPeople = async () => {
    if (people) return;
    setPeople(await loadPeople(messageId));
  };

  const title = (emoji) => {
    if (!people) return 'Кто поставил — наведите';
    const names = people.filter((p) => p.emoji === emoji).map((p) => p.name);
    return names.length > 0 ? names.join(', ') : 'Никто';
  };

  return (
    <div className={styles.chatReactions}>
      {list.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={`${styles.chatReaction} ${r.mine ? styles.chatReactionMine : ''}`}
          onMouseEnter={showPeople}
          onFocus={showPeople}
          title={title(r.emoji)}
          aria-pressed={r.mine}
          aria-label={`${r.emoji}, ${r.count}`}
          disabled={disabled}
          onClick={() => toggle(messageId, r.emoji)}
        >
          <span aria-hidden="true">{r.emoji}</span>
          <span className={styles.chatReactionCount}>{r.count}</span>
        </button>
      ))}

      {!disabled && (
        <span className={styles.chatReactionPick}>
          <button
            type="button"
            className={styles.chatReactionAdd}
            aria-label="Поставить реакцию"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            <Icon name="plus" size={12} />
          </button>
          {picking && (
            <span className={styles.chatReactionMenu} role="group" aria-label="Выбор реакции">
              {REACTION_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={styles.chatReactionChoice}
                  aria-label={emoji}
                  onClick={() => {
                    setPicking(false);
                    // Имена читателей устарели вместе со сводкой
                    setPeople(null);
                    void toggle(messageId, emoji);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
