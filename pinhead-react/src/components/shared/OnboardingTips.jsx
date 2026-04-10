import { useState, useEffect } from 'react';

const TIPS = [
  { target: '.garment-row', text: 'Выберите изделие из каталога для начала оформления заказа', position: 'right' },
  { target: '.progress-bar, .progress-bar-wrapper', text: 'Визард проведёт вас через 5 шагов: изделие → дизайн → позиции → детали → итог', position: 'bottom' },
  { target: '[data-nav="orders"]', text: 'Все созданные заказы отображаются на Kanban-доске', position: 'bottom' },
];

export default function OnboardingTips() {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('ph_onboarding_done') === '1');

  useEffect(() => {
    if (dismissed) return;
    const el = document.querySelector(TIPS[step]?.target);
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [step, dismissed]);

  if (dismissed || step >= TIPS.length) return null;

  const tip = TIPS[step];
  const targetEl = document.querySelector(tip.target);
  if (!targetEl) return null;

  const rect = targetEl.getBoundingClientRect();

  let style = {};
  if (tip.position === 'bottom') {
    style = { top: rect.bottom + 8, left: rect.left + rect.width / 2, transform: 'translateX(-50%)' };
  } else if (tip.position === 'right') {
    style = { top: rect.top, left: rect.right + 12 };
  }

  const handleNext = () => {
    if (step + 1 >= TIPS.length) {
      setDismissed(true);
      localStorage.setItem('ph_onboarding_done', '1');
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    setDismissed(true);
    localStorage.setItem('ph_onboarding_done', '1');
  };

  return (
    <>
      <div className="onboarding-backdrop" onClick={handleSkip} />
      <div className="onboarding-tip" style={style}>
        <div className="onboarding-tip-text">{tip.text}</div>
        <div className="onboarding-tip-actions">
          <button className="onboarding-skip" onClick={handleSkip}>Пропустить</button>
          <button className="onboarding-next" onClick={handleNext}>
            {step + 1 >= TIPS.length ? 'Готово' : 'Далее'}
          </button>
          <span className="onboarding-counter">{step + 1}/{TIPS.length}</span>
        </div>
      </div>
    </>
  );
}
