import { useEffect, useRef } from 'react';
import LayerRow from './LayerRow';
import styles from '../DesignTab.module.css';

/**
 * Нанесения вида на холсте — клавиатурная альтернатива холсту (план,
 * «Клавиатура»): выбор, порядок, дубль, «Снять с изделия». Сверху — верхний
 * слой (последний в позиции рисуется поверх). `focusKey` — куда перевести
 * фокус после загрузки логотипа или снятия (проверка скиллами).
 */
export default function LayerList({ entries, selectedKey, readOnly, focusKey, onFocused, onSelect, onMove, onDuplicate, onUnplace }) {
  const refs = useRef(new Map());
  useEffect(() => {
    if (!focusKey) return;
    const el = refs.current.get(focusKey);
    if (el) {
      el.focus();
      onFocused?.();
    }
  }, [focusKey, entries, onFocused]);

  if (entries.length === 0) return <p className={styles.muted}>На этом виде нанесений нет.</p>;
  const top = [...entries].reverse();
  return (
    <ul className={styles.layers} aria-label="Нанесения на виде">
      {top.map((e, i) => (
        <LayerRow
          key={e.print.key}
          entry={e}
          selected={e.print.key === selectedKey}
          readOnly={readOnly}
          last={i === 0}
          first={i === top.length - 1}
          mainRef={(el) => { if (el) refs.current.set(e.print.key, el); else refs.current.delete(e.print.key); }}
          onSelect={onSelect}
          onUp={() => onMove(e.print.key, 1)}
          onDown={() => onMove(e.print.key, -1)}
          onDuplicate={() => onDuplicate(e.print.key)}
          onUnplace={() => onUnplace(e.print.key)}
        />
      ))}
    </ul>
  );
}
