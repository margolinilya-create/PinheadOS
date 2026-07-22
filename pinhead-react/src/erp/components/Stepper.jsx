import styles from '../erp.module.css';

/**
 * Горизонтальный нумерованный степпер со счётчиками (редизайн, по UI Kit «Подряд»).
 * Показывает воронку фаз: у каждого шага — номер, подпись и число операций в этой фазе.
 * steps: [{ key, label, count }]. Шаги с count>0 подсвечиваются акцентом.
 */
export function Stepper({ steps, title }) {
  return (
    <div className={styles.numStepper}>
      {title && <span className={styles.numStepperTitle}>{title}</span>}
      <div className={styles.numStepperTrack}>
        {steps.map((s, i) => (
          <span key={s.key} className={styles.numStep}>
            <span className={`${styles.numStepDot} ${s.count > 0 ? styles.numStepDotActive : ''}`}>{i + 1}</span>
            <span className={styles.numStepText}>
              <span className={styles.numStepLabel}>{s.label}</span>
              {typeof s.count === 'number' && <span className={styles.numStepCount}>{s.count}</span>}
            </span>
            {i < steps.length - 1 && <span className={styles.numStepBar} aria-hidden="true" />}
          </span>
        ))}
      </div>
    </div>
  );
}
