import styles from '../erp.module.css';

/**
 * Индикатор стадий — единственная реализация на все три вида в ERP.
 *
 * Раньше это были три независимых компонента (`Stepper` для подряда, `Pipeline`
 * для эксперим. цеха, лента точек в карточке заказа): один и тот же смысл —
 * «горизонтальная последовательность стадий с соединителями» — жил в трёх местах,
 * и правка индикатора требовала трёх правок.
 *
 * Три ВИДА при этом сохранены осознанно (`docs/DESIGN.md` описывает их как три
 * паттерна) — они отвечают на разные вопросы:
 * - `dots` — «где сейчас эта позиция»: точки этапов маршрута с галочкой у пройденных;
 * - `funnel` — «сколько операций в каждой фазе»: нумерованная воронка со счётчиками;
 * - `pipeline` — «как разработки распределены по фазам»: узлы со стрелками
 *   и боковым узлом возврата.
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
          {n.state === 'done' ? '✓' : i + 1}
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

function PipeNode({ node, aside = false }) {
  const cls = [
    styles.pipeNode,
    !aside && node.count > 0 && styles.pipeNodeActive,
    aside && styles.pipeNodeAside,
  ].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      <span className={styles.pipeCount}>{node.count}</span>
      <span className={styles.pipeLabel}>{node.icon ? `${node.icon} ` : ''}{node.label}</span>
    </span>
  );
}

export function StageIndicator({ variant, nodes, title, aside, label }) {
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

  if (variant === 'pipeline') {
    return (
      <div className={styles.pipeline}>
        {nodes.map((n, i) => (
          <span key={n.key} className={styles.pipeNodeWrap}>
            <PipeNode node={n} />
            {i < nodes.length - 1 && (
              <span className={styles.pipeArrow} aria-hidden="true">→</span>
            )}
          </span>
        ))}
        {/* Боковой узел (возврат конструктору) — вне цепочки, поэтому без стрелки */}
        {aside && aside.count > 0 && <PipeNode node={aside} aside />}
      </div>
    );
  }

  return (
    <div className={styles.stepper} role="list" aria-label={label}>
      <DotsNodes nodes={nodes} />
    </div>
  );
}
