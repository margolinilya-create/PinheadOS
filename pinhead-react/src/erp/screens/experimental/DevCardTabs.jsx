import { onTabListKeyDown } from '../../utils/tabs';
import styles from '../../styles';

/**
 * Вкладки карточки разработки (референс заказчика 24.08):
 * Информация · Задачи · Файлы · История доработок · Финальный пакет · SKU.
 *
 * ЗАЧЕМ. Карточка была одной простынёй на 670 строк: поля разработки, маршрут
 * по этапам, две таблицы задач, форма добавления, приёмка образца, история
 * доработок, финальный пакет из двенадцати полей и перенос в каталог — всё
 * подряд. До финального пакета надо было прокрутить несколько экранов, а он
 * и есть то, ради чего разработку заканчивают.
 *
 * Паттерн тот же, что у карточки заказа, и намеренно: это ОДНА вещь в проекте,
 * а не две похожие. Полный таб-паттерн (`role="tab"` + `aria-controls` +
 * `role="tabpanel"` + roving tabindex + стрелки), а не половина — правило
 * проекта прямо говорит, что половина хуже обычных кнопок.
 *
 * Своей копии `OrderCardTabs` здесь нет по единственной причине, по которой
 * компонент вообще отдельный: у него зашит префикс `order-tab-` в `id`
 * и `aria-controls`. Два набора вкладок на одной странице (а карточка
 * разработки открыта рядом с шапкой заказа) с одинаковыми `id` — это
 * невалидный DOM и сломанная связь панели со вкладкой для скринридера.
 */
export function DevCardTabs({ tabs, active, onSelect }) {
  return (
    <div
      className={styles.deptTabs}
      role="tablist"
      aria-label="Разделы карточки разработки"
      onKeyDown={onTabListKeyDown}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`dev-tab-${t.id}`}
          aria-controls="dev-tabpanel"
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          className={`${styles.deptTab} ${active === t.id ? styles.deptTabActive : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
          {/* Счётчик отвечает на «есть ли там что-нибудь» ДО переключения.
              Ноль показываем тоже: пустая вкладка иначе неотличима
              от вкладки без счётчика */}
          {t.count !== undefined && (
            <span className={styles.deptTabCount}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
