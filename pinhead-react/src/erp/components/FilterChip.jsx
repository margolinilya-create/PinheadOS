import styles from '../erp.module.css';

/**
 * Чип-фильтр — «включено/выключено», а не переход.
 *
 * §4.3 обхода 04.09: одна и та же связка `chip + chipBtn + (chipProgress |
 * chipNeutral)` с `aria-pressed` повторялась двадцать один раз, и повторялась
 * НЕ ЦЕЛИКОМ: где-то `aria-pressed` был, где-то нет. Для скринридера это
 * разница между «фильтр „Просрочено", нажат» и просто «Просрочено» —
 * то есть между работающим фильтром и кнопкой без состояния.
 *
 * `role="tab"` здесь не ставится сознательно: половина таб-паттерна хуже
 * обычной кнопки (записанное правило проекта). Чипы — независимые
 * переключатели, а не вкладки одной панели.
 */
/**
 * ЦВЕТ ВКЛЮЧЁННОГО ЧИПА — ЗАКРЫТЫЙ НАБОР, а не свободный className.
 *
 * У списка заказов активный цвет несёт смысл: «Просрочено» красный,
 * «Стоит» янтарный, «Готовы к отгрузке» зелёный — тот же цвет, каким эти
 * состояния подписаны в самих строках. Механический перенос на общий синий
 * перекрасил бы их и снял бы связь «фильтр ↔ то, что он отбирает».
 *
 * Именно поэтому параметр, а не проброс класса: свободный `className` вернул бы
 * ровно ту россыпь копий, ради которой примитив и заведён.
 */
const TONE = {
  progress: 'chipProgress',
  waiting: 'chipWaiting',
  ready: 'chipReady',
  blocked: 'chipBlocked',
};

export function FilterChip({
  active = false, onClick, children, label, title, tone = 'progress',
  /**
   * РАСКРЫВАЮЩИЙ, А НЕ ПЕРЕКЛЮЧАЮЩИЙ. Кнопка «Фильтры», открывающая
   * дополнительный блок, — не переключатель состояния, и `aria-pressed`
   * на ней означал бы неправду: скринридер объявил бы «нажато», хотя
   * ничего не включено. Вид у неё тот же, поведение другое — поэтому
   * параметр, а не второй компонент.
   */
  expanded,
}) {
  const isOn = expanded === undefined ? active : expanded;
  return (
    <button
      type="button"
      aria-pressed={expanded === undefined ? active : undefined}
      aria-expanded={expanded}
      aria-label={label}
      title={title}
      className={`${styles.chip} ${styles.chipBtn} ${
        isOn ? styles[TONE[tone] ?? TONE.progress] : styles.chipNeutral}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
