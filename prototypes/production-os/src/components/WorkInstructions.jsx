import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import styles from './WorkInstructions.module.css';
import buildSteps from './work-instructions/buildSteps';
import StepContent from './work-instructions/StepContent';

export default function WorkInstructions() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);

  const task = tasks.find(t => t.id === taskId);
  const order = task ? orders[task.order_id] : null;
  const steps = task && order ? buildSteps(task, order) : [];

  const [currentStep, setCurrentStep] = useState(0);

  const goNext = useCallback(() => {
    setCurrentStep(s => Math.min(s + 1, steps.length - 1));
  }, [steps.length]);

  const goPrev = useCallback(() => {
    setCurrentStep(s => Math.max(s - 1, 0));
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
      if (e.key === 'Escape') navigate(-1);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev, navigate]);

  if (!task) {
    return (
      <div className={styles.rootError}>
        <div className={styles.errorMsg}>Задача не найдена: {taskId}</div>
        <button className={styles.closeBtn} onClick={() => navigate(-1)}>← Назад</button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className={styles.rootError}>
        <div className={styles.errorMsg}>Нет данных о заказе для задачи: {taskId}</div>
        <button className={styles.closeBtn} onClick={() => navigate(-1)}>← Назад</button>
      </div>
    );
  }

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.stepNum}>{currentStep + 1} / {steps.length}</span>
          <span className={styles.orderNum}>{order?.order_number || '—'}</span>
        </div>
        <button className={styles.closeBtn} onClick={() => navigate(-1)}>Закрыть</button>
      </div>

      {/* Step title */}
      <div className={styles.stepTitle}>{step?.title}</div>

      {/* Content */}
      <div className={styles.content}>
        {step && <StepContent content={step.content} />}
      </div>

      {/* Navigation */}
      <div className={styles.nav}>
        <button
          className={styles.navBtn}
          onClick={goPrev}
          disabled={isFirst}
          aria-label="Предыдущий шаг"
        >
          ←
        </button>

        <div className={styles.dots}>
          {steps.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot}${i === currentStep ? ' ' + styles.dotActive : ''}`}
              onClick={() => setCurrentStep(i)}
              aria-label={`Шаг ${i + 1}`}
            />
          ))}
        </div>

        <button
          className={styles.navBtn}
          onClick={goNext}
          disabled={isLast}
          aria-label="Следующий шаг"
        >
          →
        </button>
      </div>
    </div>
  );
}
