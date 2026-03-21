import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './ProgressBar.module.css';

const STEPS = [
  { label: 'Изделие', num: '01' },
  { label: 'Обработки', num: '02' },
  { label: 'Дизайн', num: '03' },
  { label: 'Позиции', num: '04' },
  { label: 'Детали', num: '05' },
  { label: 'Итог', num: '06' },
];

export default function ProgressBar() {
  const { step, maxStep, goToStep } = useStore(
    useShallow(s => ({ step: s.step, maxStep: s.maxStep, goToStep: s.goToStep }))
  );

  return (
    <nav className={styles['progress-bar']}>
      {STEPS.map((s, i) => {
        let cls = styles['step-tab'];
        if (i === step) cls += ` ${styles.active}`;
        else if (i < step) cls += ` ${styles.done}`;
        else if (i <= maxStep) cls += ` ${styles.visited}`;
        return (
          <button
            key={i}
            className={cls}
            onClick={() => goToStep(i)}
            disabled={i > maxStep}
          >
            <div className={styles['step-num']}>
              {i < step ? <span>✓</span> : <span>{s.num}</span>}
            </div>
            <span className={styles['step-label']}>{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
