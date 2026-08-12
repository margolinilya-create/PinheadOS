import styles from '../erp.module.css';
import { Icon } from './Icon';

/**
 * Индикатор стадий — единственная реализация на оба вида в ERP.
 *
 * Раньше это были независимые компоненты (`Stepper` для подряда, лента точек
 * в карточке заказа): один и тот же смысл — «горизонтальная последовательность
 * стадий с соединителями» — жил в нескольких местах, и правка индикатора
 * требовала нескольких правок.
 *
 * Виды отвечают на разные вопросы и потому сохранены оба:
 * - `dots` — «где сейчас эта позиция»: точки этапов маршрута с галочкой у пройденных;
 * - `funnel` — «сколько единиц на каждом шаге»: нумерованная воронка со счётчиками.
 *
 * Третий вид, `pipeline`, УДАЛЁН 12.08 вместе с фазовой моделью эксперим. цеха:
 * он рисовал распределение разработок по пяти фазам и боковой узел «возврат
 * конструктору», а фазы не хранятся вовсе — состояние вычисляется из задач
 * (`utils/experimentalTasks.devState`). После удаления `ExperimentalCard.jsx`
 * вид остался без единого вызова, и держал его только собственный тест.
 *
 * Узел: `{ key, label, count?, icon?, state?, title?, lineDone? }`,
 * где `state` — 'done' | 'active' | 'blocked' | undefined.
 */

function DotsNodes({ nodes }) {
  return nodes.map((n, i) => {
    const dotCls = [
      styles.stepperDot,
      n.state === 'done' && styles.stepperDotDone,
      n.state === 'active' && styles.stepperDotActive,
      n.state === 'blocked' && styles.stepperDotBlocked,
    ].filter(Boolean).join(' ');
    return (
      <span key={n.key} className={styles.stepperItem} role="listitem">
        {i > 0 && (
          <span className={`${styles.stepperLine} ${n.lineDone ? styles.stepperLineDone : ''}`} />
        )}
        <span className={dotCls} title={n.title} aria-label={n.title}>
          {n.state === 'done' ? <Icon name="check" size={12} /> : i + 1}
        </span>
        <span className={styles.stepperLabel}>{n.label}</span>
      </span>
    );
  });
}

function FunnelNodes({ nodes }) {
  return nodes.map((n, i) => (
    <span key={n.key} className={styles.numStep}>
      <span className={`${styles.numStepDot} ${n.count > 0 ? styles.numStepDotActive : ''}`}>
        {i + 1}
      </span>
      <span className={styles.numStepText}>
        <span className={styles.numStepLabel}>{n.label}</span>
        {typeof n.count === 'number' && <span className={styles.numStepCount}>{n.count}</span>}
      </span>
      {i < nodes.length - 1 && <span className={styles.numStepBar} aria-hidden="true" />}
    </span>
  ));
}

export function StageIndicator({ variant, nodes, title, label }) {
  if (variant === 'funnel') {
    return (
      <div className={styles.numStepper}>
        {title && <span className={styles.numStepperTitle}>{title}</span>}
        <div className={styles.numStepperTrack}>
          <FunnelNodes nodes={nodes} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stepper} role="list" aria-label={label}>
      <DotsNodes nodes={nodes} />
    </div>
  );
}
