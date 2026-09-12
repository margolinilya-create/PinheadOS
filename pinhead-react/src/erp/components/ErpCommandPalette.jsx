import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { buildCommandEntries, nextIndex } from '../utils/commandPalette';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Icon } from './Icon';
import styles from './ErpCommandPalette.module.css';

/**
 * КОМАНДНАЯ СТРОКА РАЗДЕЛА — Ctrl/Cmd+K.
 *
 * Приём с bencho.dev (блок `Command bar`), но взята только форма: одно поле,
 * которое разворачивается в список и ведёт куда надо. Содержимое здесь своё
 * и приезжает из существующих источников — см. `utils/commandPalette`.
 *
 * ЗАЧЕМ. У оболочки ERP палитры не было вовсе: в шапке стоит поле поиска
 * заказов без единого сочетания клавиш, а разделов четырнадцать плюс столько
 * же цехов. Попасть в очередь чужого участка значило открыть меню и найти
 * пункт глазами. У Order Studio палитра есть, но там семь вписанных руками
 * пунктов, и `Enter` в ней всегда берёт ПЕРВЫЙ результат — стрелок нет.
 *
 * ─── ПОЛНЫЙ ПАТТЕРН СПИСКА, А НЕ ПОЛОВИНА ─────────────────────────────────
 * `role="listbox"` + `role="option"` + `aria-activedescendant` + `aria-selected`.
 * Фокус остаётся в поле (человек печатает), а выбор ведёт `activedescendant` —
 * иначе каждая стрелка уводила бы фокус из ввода. Половина паттерна в этом
 * проекте запрещена прямым правилом.
 *
 * ─── ГЕЙТ ПО ПРАВУ — В `buildCommandEntries` ──────────────────────────────
 * Здесь его нет и быть не должно: вторая реализация «кому что видно»
 * разошлась бы с меню, а у этого дефекта в проекте уже есть история.
 */
export default function ErpCommandPalette({ onClose }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();
  const navigate = useNavigate();
  const access = useErpAccess();

  const { departments, orders } = useErpStore(useShallow((s) => ({
    departments: s.departments,
    orders: s.orders,
  })));

  const entries = useMemo(
    () => buildCommandEntries(query, { access, departments, orders }),
    [query, access, departments, orders],
  );

  /**
   * Фокус — в поле при монтировании.
   *
   * Чистить `query`/`cursor` не нужно вовсе: оболочка монтирует палитру
   * только на время открытия, то есть каждое открытие и есть чистый лист.
   * Это дешевле эффекта на `open` и не может разойтись с путями закрытия —
   * а их три (Escape, клик по фону, переход).
   */
  useEffect(() => { inputRef.current?.focus(); }, []);

  /**
   * ВЫБОР ЗАЖИМАЕТСЯ ПРИ ОТРИСОВКЕ, А НЕ ЭФФЕКТОМ.
   *
   * Список перестраивается на каждый введённый символ, и выбор легко
   * оказывается за его концом. Чинить это `setCursor` в эффекте нельзя
   * (`react-hooks/set-state-in-effect`) и не нужно: производную величину
   * считают, а не хранят. Эффект дал бы лишний кадр, в котором
   * `aria-activedescendant` указывает на опцию, которой уже нет.
   */
  const cursorAt = cursor >= entries.length ? 0 : cursor;

  const trapRef = useFocusTrap(true, onClose);

  const go = (entry) => {
    if (!entry) return;
    onClose();
    navigate(entry.to);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(nextIndex(cursorAt, entries.length, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // ВЫБРАННЫЙ, а не первый: именно этим сломана палитра Order Studio
      go(entries[cursorAt]);
    }
    /*
     * ESCAPE ЗДЕСЬ НЕ ОБРАБАТЫВАЕТСЯ — его ведёт `useFocusTrap`.
     *
     * Своя ветка тут была, и сторож поймал ровно то, чем она плоха: `onClose`
     * вызывался ДВАЖДЫ на одно нажатие. Ничего не ломалось (закрытие
     * идемпотентно), но это два места, решающих один вопрос, — и следующая
     * правка одного из них разошлась бы со вторым молча. Escape — работа
     * оболочки окна, и в проекте её делает примитив ловушки фокуса:
     * так же у `Modal`, `Drawer` и `ConfirmDialog`.
     */
  };

  const optionId = (i) => `${listId}-opt-${i}`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={trapRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Быстрый переход"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.inputRow}>
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={entries.length ? optionId(cursorAt) : undefined}
            aria-label="Раздел, цех или заказ"
            placeholder="Раздел, цех или номер заказа…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
          />
        </div>

        {entries.length === 0 ? (
          <p className={styles.empty}>
            {query ? `Ничего не нашлось по «${query}»` : 'Начните вводить'}
          </p>
        ) : (
          <ul className={styles.list} id={listId} role="listbox" aria-label="Результаты">
            {entries.map((entry, i) => {
              // Заголовок группы рисуется при СМЕНЕ группы: так он не требует
              // второго прохода и не разъезжается с порядком записей
              const head = i === 0 || entries[i - 1].group !== entry.group;
              return (
                <li key={entry.key} className={styles.item}>
                  {head && <span className={styles.groupHead} aria-hidden="true">{entry.group}</span>}
                  <div
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === cursorAt}
                    className={`${styles.option} ${i === cursorAt ? styles.optionActive : ''}`}
                    /* Наведение двигает ВЫБОР, а не подсвечивает отдельно:
                       две подсветки рядом — это вопрос, какая из них сработает
                       по Enter */
                    onMouseMove={() => setCursor(i)}
                    onClick={() => go(entry)}
                  >
                    <Icon name={entry.icon} size={15} />
                    <span className={styles.optionLabel}>{entry.label}</span>
                    {entry.hint && <span className={styles.optionHint}>{entry.hint}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className={styles.footer} aria-hidden="true">
          <kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>Enter</kbd> открыть · <kbd>Esc</kbd> закрыть
        </div>
      </div>
    </div>
  );
}
