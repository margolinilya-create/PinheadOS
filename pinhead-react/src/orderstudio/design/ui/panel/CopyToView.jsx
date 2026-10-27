import { useId, useMemo } from 'react';
import { VIEW_LABELS } from '../../catalog/flatLabels';
import { useDesignStore } from '../../store/useDesignStore';
import { MSG_ADD_BLOCKED_MISMATCH } from '../useArtworkActions';
import { copyTargets, copyToView } from './copyOps';
import styles from '../DesignTab.module.css';

/**
 * «Копировать на вид» (веха 5в, Э2): копия выбранного нанесения на другой вид
 * силуэта — рукав ↔ рукав зеркально (`copyOps`). Только черновик и флаг
 * «Дизайн» 2.0. Силуэт другой модели — недоступно с причиной (правило Э1:
 * новые нанесения на чужой силуэт не ставятся). После копии — вид цели
 * и выбор копии (сначала вид: `setView` снимает выбор).
 */
export default function CopyToView({ d, entry }) {
  const reasonId = useId();
  const targets = useMemo(() => copyTargets(entry.pl, d.ctx), [entry.pl, d.ctx]);
  if (targets.length === 0) return null;
  const blocked = d.addBlocked;
  const n = entry.index + 1;
  const copy = (target) => {
    if (blocked) return;
    let next = null;
    d.commitPrints('Копия на вид', (prints) => {
      const res = copyToView(prints, entry.print.key, target, d.ctx);
      next = res?.key ?? null;
      return res?.prints ?? null;
    });
    if (!next) return;
    const s = useDesignStore.getState();
    s.setView(target);
    s.select(next);
  };
  return (
    <div className={styles.row} role="group" aria-label={`Копировать нанесение ${n} на вид`}>
      <span className={styles.muted} aria-hidden="true">Копировать на вид:</span>
      {targets.map((t) => (
        <button
          key={t}
          type="button"
          className={styles.btn}
          aria-disabled={blocked ? 'true' : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => copy(t)}
        >
          {VIEW_LABELS[t]}
        </button>
      ))}
      {blocked && <p id={reasonId} className={styles.muted}>{MSG_ADD_BLOCKED_MISMATCH}</p>}
    </div>
  );
}
