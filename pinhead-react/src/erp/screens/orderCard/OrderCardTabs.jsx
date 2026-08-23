import { onTabListKeyDown } from '../../utils/tabs';
import styles from '../../styles';

/**
 * Вкладки карточки заказа: Позиции · ТЗ · Материалы · Файлы · Комментарии · История.
 *
 * Зачем. Карточка была одной простынёй: маршрут по этапам, блок ТЗ на каждую
 * позицию, материалы, файлы, переписка и две ленты истории (события этапов
 * и лог правок) — всё подряд, друг под другом. На заказе с тремя позициями
 * до комментариев надо было прокрутить несколько экранов, а история, ради
 * которой карточку чаще всего и открывают, оказывалась в самом низу.
 *
 * Здесь ПОЛНЫЙ таб-паттерн (`role="tab"` + `aria-controls` + `role="tabpanel"`
 * + roving tabindex + стрелки через `onTabListKeyDown`), а не половина: правило
 * проекта прямо говорит, что половина хуже обычных кнопок. Он уместен именно
 * тут — вкладки переключают панели ОДНОЙ страницы. У раздела «Производство»
 * наоборот: там каждая вкладка это свой адрес, и потому там ссылки.
 *
 * Активная вкладка живёт в адресе (`?tab=`): «посмотри историю по этому заказу»
 * должно пересылаться ссылкой, как и всякий контекст списка.
 */

export function OrderCardTabs({ tabs, active, onSelect }) {
  return (
    <div
      className={styles.deptTabs}
      role="tablist"
      aria-label="Разделы карточки заказа"
      onKeyDown={onTabListKeyDown}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`order-tab-${t.id}`}
          aria-controls="order-tabpanel"
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          className={`${styles.deptTab} ${active === t.id ? styles.deptTabActive : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
          {/* Счётчик — часть подписи, а не украшение: он отвечает на вопрос
              «есть ли там что-нибудь» до переключения. Ноль показываем тоже,
              иначе пустая вкладка неотличима от вкладки без счётчика. */}
          {t.count !== undefined && (
            <span className={styles.deptTabCount}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
