import { useStore } from '../../store/useStore';

const STEPS = [
  { label: 'Изделие', num: '01' },
  { label: 'Обработки', num: '02' },
  { label: 'Дизайн', num: '03' },
  { label: 'Позиции', num: '04' },
  { label: 'Детали', num: '05' },
  { label: 'Итог', num: '06' },
];

export default function ProgressBar() {
  const { step, maxStep, goToStep } = useStore();

  return (
    <nav className="progress-bar">
      {STEPS.map((s, i) => {
        let cls = 'step-tab';
        if (i === step) cls += ' active';
        else if (i < step) cls += ' done';
        else if (i <= maxStep) cls += ' visited';
        return (
          <button
            key={i}
            className={cls}
            onClick={() => goToStep(i)}
            disabled={i > maxStep}
          >
            <div className="step-num">
              {i < step ? <span>✓</span> : <span>{s.num}</span>}
            </div>
            <span className="step-label">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
