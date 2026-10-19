import { useEffect, useRef } from 'react';

/**
 * ФОКУС ПОСЛЕ «УБРАТЬ» (правка 19.10, п. 4 — строки файлов пачки).
 *
 * Кнопка, на которой стоял фокус, исчезает вместе со строкой, и браузер
 * сбрасывает фокус на `<body>`: человек с клавиатурой или читалкой теряет
 * место в форме и начинает обход сначала. Поэтому фокус переносится на
 * соседнюю строку (следующую, а у последней — предыдущую), а когда строк
 * не осталось — на кнопку выбора файлов этого блока.
 *
 * Разметка: внутри `containerRef` у кнопки «Убрать» строки —
 * `data-row-focus="<id>"`, у кнопки выбора — `data-pick-focus`.
 * `markRemoved(ids, id)` зовётся ДО удаления; перенос — после ближайшей
 * перерисовки, когда строки уже нет.
 */
export function useRemovalFocus(containerRef) {
  const pending = useRef(null);

  useEffect(() => {
    if (!pending.current) return;
    const root = containerRef.current;
    const { neighbor } = pending.current;
    pending.current = null;
    if (!root) return;
    const row = neighbor ? root.querySelector(`[data-row-focus="${neighbor}"]`) : null;
    // Выключенная кнопка (соседний файл ещё грузится) фокус не примет
    (row && !row.disabled ? row : root.querySelector('[data-pick-focus]'))?.focus();
  });

  return (ids, id) => {
    const i = ids.indexOf(id);
    pending.current = { neighbor: ids[i + 1] ?? ids[i - 1] ?? null };
  };
}
