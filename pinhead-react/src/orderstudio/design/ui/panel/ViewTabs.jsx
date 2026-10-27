import { useRef } from 'react';
import { VIEW_LABELS } from '../../catalog/flatLabels';
import { viewPlacements } from './printList';
import styles from '../DesignTab.module.css';

/** Клавиши перехода между вкладками: шаг или край списка */
const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Виды изделия в шапке холста (перенос DM `ViewTabs`; веха 5б — рукава).
 *
 * - вкладки — только видов, которые есть у флэта (`views` — порядок перед →
 *   спина → левый → правый рукав, `ui/useItemFlat.viewsOf`); подписи —
 *   `VIEW_LABELS`, число нанесений вида — рядом;
 * - клавиатура `tablist`: Tab ведёт на выбранную вкладку, стрелки и
 *   Home/End — по вкладкам с выбором (автоматическая активация), фокус идёт
 *   за выбором; панель вида — сам холст («Холст: модель, вид …»).
 */
export default function ViewTabs({ flat, views, prints, view, onView }) {
  const refs = useRef({});
  if (views.length < 2) return null;

  const go = (kind) => {
    onView(kind);
    refs.current[kind]?.focus();
  };
  const onKeyDown = (e) => {
    const at = views.indexOf(view);
    let next = null;
    if (e.key in STEP) next = views[(at + STEP[e.key] + views.length) % views.length];
    else if (e.key === 'Home') next = views[0];
    else if (e.key === 'End') next = views[views.length - 1];
    if (!next) return;
    e.preventDefault();
    go(next);
  };

  return (
    <div className={styles.row} role="tablist" aria-label="Вид изделия">
      {views.map((kind) => {
        const n = viewPlacements(prints, { flat }, kind).length;
        const selected = kind === view;
        return (
          <button
            key={kind}
            ref={(el) => { refs.current[kind] = el; }}
            type="button"
            role="tab"
            className={styles.toggle}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onView(kind)}
            onKeyDown={onKeyDown}
          >
            {VIEW_LABELS[kind]}{n > 0 ? ` · ${n}` : ''}
          </button>
        );
      })}
    </div>
  );
}
