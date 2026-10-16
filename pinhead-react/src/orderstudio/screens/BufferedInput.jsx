import { useState } from 'react';

/**
 * Поле с буфером набора.
 *
 * Контролируемое поле, которое на каждом нажатии превращает текст в значение
 * модели и обратно, съедает промежуточный ввод: «2500,» сразу становилось
 * 2500 (следующая цифра дописывалась к целой части — 25005), «186 C, » —
 * «186C», а «6» в поле процентов зажималось до минимума и становилось 100.
 * Здесь набранный текст живёт в поле, пока оно в фокусе; модель получает
 * значение, только когда `parse` его узнаёт (`undefined` — «ещё не число,
 * ждём»), а на потере фокуса текст выравнивается по модели.
 *
 * `parse(text) → value | undefined`, `format(value) → text`.
 */
export default function BufferedInput({ value, parse, format, onCommit, ...rest }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? format(value);
  return (
    <input
      {...rest}
      value={shown}
      onFocus={() => setDraft(format(value))}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const next = parse(text);
        if (next !== undefined) onCommit(next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
