import { viewPlacements } from './panelOps';
import styles from '../DesignTab.module.css';

const VIEW_LABELS = { front: 'Перед', back: 'Спина' };

/**
 * «Перед / Спина» в шапке холста (перенос DM `ViewTabs`): число нанесений
 * вида — рядом с подписью. Переключатели (`aria-pressed`), а не вкладки:
 * панель вида — сам холст, он уже назван «Холст: модель, вид …».
 */
export default function ViewTabs({ flat, views, prints, view, onView }) {
  if (views.length < 2) return null;
  return (
    <div className={styles.row} role="group" aria-label="Вид изделия">
      {views.map((kind) => {
        const n = viewPlacements(prints, { flat }, kind).length;
        return (
          <button
            key={kind}
            type="button"
            className={styles.toggle}
            aria-pressed={kind === view}
            onClick={() => onView(kind)}
          >
            {VIEW_LABELS[kind]}{n > 0 ? ` · ${n}` : ''}
          </button>
        );
      })}
    </div>
  );
}
