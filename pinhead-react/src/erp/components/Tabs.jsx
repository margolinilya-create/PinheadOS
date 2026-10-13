import { onTabListKeyDown } from '../utils/tabs';
import styles from '../styles';

/**
 * ВКЛАДКИ ОДНОЙ СТРАНИЦЫ — ОДНА РЕАЛИЗАЦИЯ ПАТТЕРНА.
 *
 * Правило проекта: `role="tab"` ставится ТОЛЬКО вместе с `tablist`,
 * `aria-controls`, `role="tabpanel"`, roving tabindex и стрелками
 * (`utils/tabs.onTabListKeyDown`). Половина паттерна хуже обычных кнопок
 * с `aria-pressed` — и именно поэтому паттерн не должен переписываться
 * от руки: забыть в нём можно ровно половину, а выглядеть она будет так же.
 *
 * ЧТО БЫЛО. Шесть мест писали его вручную. `OrderCardTabs` и `DevCardTabs`
 * совпадали ПОБАЙТОВО, кроме трёх строк — `aria-label`, префикса `id`
 * и `aria-controls`; комментарий второго честно объяснял, что копия заведена
 * из-за «зашитого префикса `order-tab-`», то есть из-за ПАРАМЕТРА. Ещё две
 * копии лежали инлайном в `AdminScreen` и `DictionariesTab`.
 *
 * И половина уже успела потеряться: у `PlanScreen` кнопки вкладок были
 * БЕЗ `id`, а панель — без `aria-labelledby`, то есть панель не была связана
 * со своей вкладкой ни в одну сторону. Пять мест из шести это делали,
 * шестое молча нет — ровно тот отказ, от которого паттерн и защищают.
 *
 * ПОЧЕМУ ПАРА `Tabs` + `TabPanel`. Связь двусторонняя: вкладка ссылается
 * на панель (`aria-controls`), панель на вкладку (`aria-labelledby`).
 * Разнесённые по разным файлам половины расходятся — это и произошло.
 * Оба конца собираются из одного `idPrefix`, и забыть один из них нельзя.
 *
 * `Drawer` СЮДА НЕ ВХОДИТ: его вкладочная ветка удалена в том же коммите как
 * мёртвая — ни один из трёх вызывающих не передавал `tabs` с 16.08, когда
 * убрали боковую карточку заказа (её стародавний `aria-label` там и остался).
 *
 * Переключатели ВИДА (`OrdersScreen`, `ProductionBoard`, `Experimental`,
 * панель очереди) сюда тоже не идут и не должны: у них нет панелей,
 * это кнопки с `aria-pressed` — записанное решение проекта.
 */
export function Tabs({
  /** Префикс `id` вкладок; из него же собирается `id` панели */
  idPrefix,
  /** Имя набора для скринридера */
  label,
  /** `[{ id, label, count? }]`; `label` может быть узлом (иконка, счётчики) */
  tabs,
  active,
  onSelect,
  /** Ряд вкладок бывает прокручиваемым — подсказкам прокрутки нужен узел */
  listRef,
}) {
  return (
    <div
      className={styles.deptTabs}
      role="tablist"
      aria-label={label}
      ref={listRef}
      onKeyDown={onTabListKeyDown}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-controls={`${idPrefix}-tabpanel`}
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          className={`${styles.deptTab} ${active === t.id ? styles.deptTabActive : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
          {/* Счётчик — часть подписи, а не украшение: он отвечает на вопрос
              «есть ли там что-нибудь» ДО переключения. Ноль показываем тоже,
              иначе пустая вкладка неотличима от вкладки без счётчика. */}
          {t.count !== undefined && (
            <span className={styles.deptTabCount}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Панель активной вкладки — вторая половина связи.
 *
 * `tabIndex={-1}` осознан: содержимое панели бывает нефокусируемым целиком
 * (таблица, текст), и без него стрелка со вкладки уводила бы фокус мимо.
 */
export function TabPanel({ idPrefix, active, className, children }) {
  return (
    <div
      className={className}
      id={`${idPrefix}-tabpanel`}
      role="tabpanel"
      /* Ничего не выбрано — ссылки нет вовсе: `aria-labelledby` на
         несуществующий id хуже отсутствующего, скринридер объявит панель
         безымянной, но потратит на поиск. Так бывает у очереди цеха, пока
         человек не выбрал участок */
      aria-labelledby={active ? `${idPrefix}-tab-${active}` : undefined}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}
