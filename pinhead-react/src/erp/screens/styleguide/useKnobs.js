import { useState } from 'react';

/**
 * Состояние ручек витрины.
 *
 * Отдельный файл, а не строка в `Knobs.jsx`: правило
 * `react-refresh/only-export-components` запрещает файлу экспортировать
 * компоненты вместе с чем-то ещё, а хук компонентом не является. В проекте
 * так же разведены `purchaseLabels` и `hasLegacySubcontracts`.
 *
 * Хук, а не `useState` в каждом разделе: иначе каждый новый механизм заводил
 * бы свой контейнер состояния со своим способом читать `default`.
 */
/** Начальное состояние из объявленных `default`. */
export function useKnobs(params) {
  const [state, setState] = useState(() => Object.fromEntries(
    params.map((p) => [p.id, p.default]),
  ));
  const set = (id, v) => setState((s) => ({ ...s, [id]: v }));
  return [state, set];
}
