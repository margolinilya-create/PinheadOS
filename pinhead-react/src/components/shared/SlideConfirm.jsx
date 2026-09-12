import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './SlideConfirm.module.css';

/** Доля ширины трека, на которой действие считается подтверждённым. */
export const COMMIT_AT = 0.92;

/**
 * ПРОТЯЖКА ВМЕСТО ТАПА — для необратимых действий на планшете цеха.
 *
 * Приём с bencho.dev (блок `Slide to confirm`), переписанный без зависимостей:
 * у них `framer-motion`, здесь — `pointer`-события и CSS-переход на возврат.
 *
 * ЗАЧЕМ. В ERP двенадцать необратимых действий, и все идут через один
 * `ConfirmDialog` с danger-кнопкой: «оставшиеся 60 шт будут записаны как
 * выполненные», «перекроенные единицы пройдут этапы заново». На планшете,
 * который держат в руке в цеху, эта кнопка в ОДНОМ случайном тапе от запуска.
 * Текст последствий при этом остаётся на месте — протяжка не заменяет
 * объяснение, она заменяет только кнопку под ним.
 *
 * ─── КОММИТ НА ПОРОГЕ, А НЕ НА ОТПУСКАНИИ ─────────────────────────────────
 * Так сделано у bencho, и это важнее, чем кажется: ручка, которую надо
 * довести до конца И отпустить, даёт два способа не сработать (не дотянул,
 * отпустил раньше). Дошёл до порога — действие пошло, палец уже не нужен.
 *
 * ─── КЛАВИАТУРА: ТОТ ЖЕ ЭЛЕМЕНТ, А НЕ ВТОРАЯ КНОПКА ───────────────────────
 * Трек — настоящая `<button>`, и `Enter`/`Space` подтверждают сразу. Правило
 * проекта требует клавиатурной альтернативы у ЛЮБОГО перетаскивания (WCAG
 * 2.1.1), но вторая кнопка рядом («или нажмите Подтвердить») породила бы
 * вопрос, какая из них правильная, — тот же приём, что у `KanbanCard`
 * с Enter/Space вместо отдельной кнопки.
 *
 * ─── ДВИЖЕНИЕ НИЧЕГО НЕ НЕСЁТ ─────────────────────────────────────────────
 * Глобальный `prefers-reduced-motion` в `styles/utils.css` гасит переход
 * возврата через `!important`. Это допустимо: возврат ручки — украшение,
 * а смысл («дотяни до конца») держат подпись и положение, а не анимация.
 */
export function SlideConfirm({ label, hint, disabled = false, onCommit }) {
  const trackRef = useRef(null);
  /** Доля пройденного пути, 0…1. В состоянии — от неё зависит вид ручки. */
  const [progress, setProgress] = useState(0);
  const dragging = useRef(false);
  /** Коммит строго один: порог можно проехать несколькими событиями. */
  const fired = useRef(false);

  const reset = useCallback(() => {
    dragging.current = false;
    setProgress(0);
  }, []);

  // Протяжка не имеет права пережить размонтирование: диалог мог закрыться
  // по Escape, пока палец на треке, и `pointerup` до нас уже не дойдёт.
  useEffect(() => reset, [reset]);

  const fractionAt = (clientX) => {
    const el = trackRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    if (box.width <= 0) return 0;
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
  };

  const commit = () => {
    if (fired.current) return;
    fired.current = true;
    dragging.current = false;
    setProgress(1);
    onCommit();
  };

  const onPointerDown = (e) => {
    if (disabled || fired.current) return;
    // Захват: палец, ушедший за край трека, продолжает тянуть. Без захвата
    // протяжка обрывается, стоит соскользнуть с узкой полосы.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setProgress(fractionAt(e.clientX));
  };

  const onPointerMove = (e) => {
    if (!dragging.current || fired.current) return;
    const f = fractionAt(e.clientX);
    setProgress(f);
    if (f >= COMMIT_AT) commit();
  };

  const onKeyDown = (e) => {
    if (disabled || fired.current) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    commit();
  };

  return (
    <div className={styles.wrap}>
      <button
        ref={trackRef}
        type="button"
        className={styles.track}
        style={{ '--slide-progress': progress }}
        disabled={disabled}
        /* Имя кнопки — это ДЕЙСТВИЕ, а не инструкция по жесту: скринридер
           и клавиатура подтверждают нажатием, и «проведите вправо» сбивало
           бы с толку ровно тех, кто проводить не может. Подсказка про жест
           живёт видимым текстом ниже и помечена aria-hidden. */
        aria-label={label}
        /* touch-action: none — в CSS. Без него браузер планшета принимает
           протяжку за прокрутку страницы и забирает указатель себе. */
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={reset}
        onPointerCancel={reset}
        onKeyDown={onKeyDown}
      >
        {/*
          Доля пути отдаётся в CSS ОДНИМ числом (`--slide-progress`), а
          геометрию из него считает сам CSS: ручка сдвигается на
          `(100% - её ширина) * доля` и потому при доле 1 встаёт вплотную
          к правому краю, не вылезая за трек. Считать то же в JS значило бы держать ширину ручки
          в двух местах — в пикселях здесь и в CSS там.
          Нажатое состояние ручки даёт `:active` в CSS, а не класс из ref:
          ref во время рендера не читают, и подсветка отставала бы на кадр.
        */}
        <span className={styles.fill} aria-hidden="true" />
        <span className={styles.label}>{label}</span>
        <span className={styles.grip} aria-hidden="true">→</span>
      </button>
      <span className={styles.hint} aria-hidden="true">
        {hint || 'Проведите до конца, чтобы подтвердить'}
      </span>
    </div>
  );
}
