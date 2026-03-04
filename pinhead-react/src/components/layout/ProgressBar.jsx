import { useStore } from '../../store/useStore';

const STEPS = [
  { label: 'Изделие', icon: '1' },
  { label: 'Обработки', icon: '2' },
  { label: 'Дизайн', icon: '3' },
  { label: 'Детали', icon: '4' },
  { label: 'Итог', icon: '5' },
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
            <span className="step-num">{s.icon}</span>
            <span className="step-label">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
