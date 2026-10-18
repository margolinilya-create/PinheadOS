import { useId, useRef } from 'react';
import s from '../ExpressCalc.module.css';

/**
 * Выбор одного варианта (формат, цвета, текстиль, эффект, нити, техника) — радиогруппа.
 *
 * До рестайла (веха 8, задача 4) выбор передавался только классом `active`: читалка
 * слышала «кнопка A4» без «выбрано», а техника была `<div onClick>` — с клавиатуры
 * не выбрать (WCAG 2.1.1). Теперь — `role="radiogroup"` с подписью группы и `role="radio"`
 * с `aria-checked`; в ряд заходят одной табуляцией (фокус — на выбранном), стрелки,
 * Home и End двигают выбор, как у обычной радиогруппы.
 *
 * Кнопка — нативная `<button>` с классом модуля, а не примитив `Button`: см. шапку
 * `ExpressCalc.module.css` (почему импорт примитива из экспресса менял оболочку ERP).
 */
const NEXT = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export default function OptionGroup({ label, options, value, onChange }) {
  const id = useId();
  const refs = useRef([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const move = (e) => {
    let to;
    if (e.key in NEXT) to = (current + NEXT[e.key] + options.length) % options.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = options.length - 1;
    else return;
    e.preventDefault();
    onChange(options[to].value);
    refs.current[to]?.focus();
  };

  return (
    <div className={s.group}>
      <span id={id} className={s.groupLabel}>{label}</span>
      <div role="radiogroup" aria-labelledby={id} className={s.options}>
        {options.map((o, i) => {
          const checked = i === current;
          return (
            <button
              type="button"
              key={o.value}
              ref={(el) => { refs.current[i] = el; }}
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className={s.opt}
              onKeyDown={move}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
