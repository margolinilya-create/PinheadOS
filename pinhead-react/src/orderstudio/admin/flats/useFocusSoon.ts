/**
 * Фокус после перерисовки (веха 5б, задача 6б, правила фокуса редактора флэта):
 * `focusSoon(id)` — поле по DOM-id получит фокус, когда React дорисует экран
 * (новая зона, соседняя строка, вкладка нового вида). Запасные id — если
 * первого в дереве нет («соседней строки нет — на «Добавить зону»»).
 *
 * Смена вида идёт через адрес (`?view=`), и роутер может дорисовать её
 * отдельным проходом — поэтому цель ищется после каждой из нескольких
 * ближайших перерисовок, а не только первой.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Сколько перерисовок ждать цель, прежде чем забыть запрос */
const MAX_RENDERS = 5;

export function useFocusSoon(): (...ids: (string | null | undefined)[]) => void {
  const pending = useRef<{ ids: string[]; left: number } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    const el = p.ids.map((id) => document.getElementById(id)).find(Boolean);
    if (el) {
      pending.current = null;
      el.focus();
      return;
    }
    p.left -= 1;
    if (p.left <= 0) pending.current = null;
  });

  return useCallback((...next) => {
    pending.current = { ids: next.filter((x): x is string => !!x), left: MAX_RENDERS };
    setTick((n) => n + 1);
  }, []);
}
