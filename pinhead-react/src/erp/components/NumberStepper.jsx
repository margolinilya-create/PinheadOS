import { useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { HOLD_MS, sweptSteps, valueAfterSteps, clampValue } from '../utils/stepperSweep';
import styles from './NumberStepper.module.css';

/**
 * ЧИСЛОВОЕ ПОЛЕ С ШАГОМ: тап — один шаг, удержание — свип.
 *
 * Приём с bencho.dev (блок `Drag stepper`), переписанный без зависимостей:
 * у них это `framer-motion`, здесь — `pointer`-события и один `rAF`-цикл.
 * Кривая разгона живёт в `utils/stepperSweep` и проверяется значениями.
 *
 * ЗАЧЕМ ОН ЗДЕСЬ. До 12.09 вся числовая сдача в ERP была голым
 * `input type="number"`: на планшете цеха это значит «открой системную
 * клавиатуру поверх формы, найди цифру, закрой клавиатуру». Для «принято 3»
 * или «брак 1» — а это типичные величины приёмки — два тапа по ±
 * заменяют всю эту церемонию. Единственный степпер в проекте жил
 * в `steps/garment/SizeTable` (Order Studio, за флагом) и сюда не ехал.
 *
 * ─── ПОЛЕ ВВОДА ОСТАЁТСЯ НАСТОЯЩИМ ────────────────────────────────────────
 * Не подпись, не «умный» виджет — живой `input inputMode="numeric"`. Для 47
 * из 120 набрать быстрее, чем свайпнуть, и отнимать эту возможность нельзя:
 * степпер помогает малым величинам и не должен мешать большим.
 *
 * ─── ЧТО ОТДАЁТ onChange ──────────────────────────────────────────────────
 * СТРОКУ, как нативное поле (`e.target.value`). Так устроены все восемь мест
 * вызова: они держат значение строкой в состоянии экрана, и вторая форма
 * («иногда число») заставила бы каждое из них угадывать, что приехало.
 * Пустая строка остаётся пустой строкой — это отдельное состояние, а не ноль:
 * поле факта в проекте стоит ПУСТЫМ намеренно, чтобы один тап не закрыл день
 * на полный объём.
 *
 * ─── ГРАНИЦЫ ПРИМЕНЯЮТСЯ К КНОПКАМ, А НЕ К НАБОРУ ─────────────────────────
 * `min`/`max` зажимают шаг кнопки и гасят её на границе. Набранный текст
 * НЕ зажимается: при `min = 5` человек, набирающий «10», после первой цифры
 * получил бы «5» и не смог бы дописать вторую. Санитайзинг ввода остаётся
 * у вызывающего — там, где он и был (приёмка подряда, например, вырезает
 * минус).
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  unit,
  ariaLabel,
  placeholder,
  disabled = false,
  id,
  className,
  inputClassName,
}) {
  /**
   * Состояние свипа в ref, а не в useState: цикл читает его из колбэка rAF,
   * то есть вне рендера, и перерисовка здесь не нужна — меняется значение
   * снаружи, а оно и так приходит пропом.
   */
  const sweep = useRef(null);

  const numeric = (v) => {
    const n = Number(v);
    return v === '' || v === null || v === undefined || Number.isNaN(n) ? null : n;
  };

  const stop = useCallback(() => {
    const s = sweep.current;
    if (!s) return;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.timer) clearTimeout(s.timer);
    sweep.current = null;
  }, []);

  // Цикл не имеет права пережить размонтирование: палец мог уйти вместе
  // с закрытой шторкой, и `pointerup` до нас уже не дойдёт.
  useEffect(() => stop, [stop]);

  const begin = (dir, e) => {
    if (disabled) return;
    // Захват указателя: палец, соскользнувший с кнопки, продолжает свип,
    // а `pointerup` приходит сюда, а не улетает соседу.
    e.currentTarget.setPointerCapture(e.pointerId);

    /**
     * ПЕРВЫЙ ШАГ ВЫДАЁТСЯ СРАЗУ, а не по отпусканию. Кнопка, отвечающая
     * только на `pointerup`, читается как несработавшая — ровно та жалоба
     * («не срабатывает с первого раза»), из-за которой 30.08 переделывали
     * «Взять в работу».
     */
    const start = numeric(value) ?? clampValue(0, min, max);
    const first = valueAfterSteps(start, 1, dir, step, min, max);
    onChange(String(first));

    // Отсюда и дальше считаем от ПЕРВОГО шага: так `emitted` совпадает
    // с числом уже отданных шагов, и добор разницы не двоит его.
    sweep.current = { dir, start, emitted: 1, from: 0, raf: 0, timer: 0 };

    sweep.current.timer = setTimeout(() => {
      const s = sweep.current;
      if (!s) return;
      s.from = performance.now();
      const tick = () => {
        const cur = sweep.current;
        if (!cur) return;
        const due = 1 + sweptSteps(performance.now() - cur.from);
        if (due > cur.emitted) {
          cur.emitted = due;
          const next = valueAfterSteps(cur.start, due, cur.dir, step, min, max);
          onChange(String(next));
          // Дошли до границы — дальше крутить нечего, и держать кадры незачем
          const edge = cur.dir === 1 ? max : min;
          if (typeof edge === 'number' && next === edge) { stop(); return; }
        }
        cur.raf = requestAnimationFrame(tick);
      };
      s.raf = requestAnimationFrame(tick);
    }, HOLD_MS);
  };

  const n = numeric(value);
  const atMin = typeof min === 'number' && n !== null && n <= min;
  const atMax = typeof max === 'number' && n !== null && n >= max;

  const btn = (dir, icon, label, off) => (
    <button
      type="button"
      className={styles.btn}
      aria-label={label}
      disabled={disabled || off}
      onPointerDown={(e) => begin(dir, e)}
      onPointerUp={stop}
      onPointerCancel={stop}
      /* Клавиатура сюда доходит своим путём: нативное поле между кнопками
         держит ↑/↓, а сами кнопки отвечают на Enter/Space как обычные
         кнопки — их `onClick` не нужен, потому что `pointerdown` уже выдал
         шаг, а повторный клик удвоил бы его. */
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const start = numeric(value) ?? clampValue(0, min, max);
        onChange(String(valueAfterSteps(start, 1, dir, step, min, max)));
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <span className={[styles.wrap, className].filter(Boolean).join(' ')}>
      {btn(-1, 'minus', 'Уменьшить', atMin)}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className={[styles.input, inputClassName].filter(Boolean).join(' ')}
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {unit && <span className={styles.unit}>{unit}</span>}
      {btn(1, 'plus', 'Увеличить', atMax)}
    </span>
  );
}
