import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './ProgressBar.module.css';

const STEPS = [
  { label: 'Изделие', num: '01' },
  { label: 'Дизайн', num: '02' },
  { label: 'Позиции', num: '03' },
  { label: 'Детали', num: '04' },
  { label: 'Итог', num: '05' },
];

export default function ProgressBar() {
  const { step, maxStep, goToStep, sku, zones, noPrint, items, name } = useStore(
    useShallow(s => ({ step: s.step, maxStep: s.maxStep, goToStep: s.goToStep,
      sku: s.sku, zones: s.zones, noPrint: s.noPrint, items: s.items, name: s.name }))
  );

  const stepDone = [
    sku !== null,
    zones.length > 0 || noPrint,
    items.length > 0,
    (name || '').trim().length > 0,
    false,
  ];

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
            <span className={styles['step-label']}>
              {s.label}
              {stepDone[i] && i !== step && (
                <span style={{ fontSize: 10, color: 'var(--color-text-success)', marginLeft: 4 }}>✓</span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
