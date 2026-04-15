// redesign/v2 — undo toast host
//
// Renders the stack of undo entries from useUndoStore. Each card
// auto-dismisses after AUTO_DISMISS_MS (10s, set in the store). The
// "Отменить" button calls the restore lambda and removes the card.

import { useUndoStore } from '../../../store/useUndoStore';
import s from './v2.module.css';

export default function UndoToastHost() {
  const entries = useUndoStore((st) => st.entries);
  const trigger = useUndoStore((st) => st.trigger);

  if (entries.length === 0) return null;

  return (
    <div className={s.undoHost} role="region" aria-label="Undo">
      {entries.map((e) => (
        <div key={e.id} className={s.undoCard}>
          <span>{e.label}</span>
          <button
            type="button"
            className={s.undoBtn}
            onClick={() => trigger(e.id)}
          >
            Отменить
          </button>
        </div>
      ))}
    </div>
  );
}
