import useWorkshopStore from '../../store/useWorkshopStore';
import { PROBLEM_TYPES } from '../../data/workshops';
import styles from '../TaskDetail.module.css';

export default function TaskDetailActions({ task }) {
  const showProblemPicker = useWorkshopStore(s => s.showProblemPicker);
  const startTask = useWorkshopStore(s => s.startTask);
  const openHandoff = useWorkshopStore(s => s.openHandoff);
  const openProblemPicker = useWorkshopStore(s => s.openProblemPicker);
  const blockTask = useWorkshopStore(s => s.blockTask);
  const unblockTask = useWorkshopStore(s => s.unblockTask);

  function handleBlock(problemCode, label) {
    blockTask(task.id, problemCode, label);
  }

  return (
    <div className={styles.actions}>
      {task.status === 'ready' && (
        <button
          className={`${styles.btn} ${styles.btnStart}`}
          onClick={() => startTask(task.id)}
        >
          НАЧАТЬ
        </button>
      )}
      {task.status === 'in_progress' && !showProblemPicker && (
        <>
          <button className={`${styles.btn} ${styles.btnBlock}`} onClick={openProblemPicker}>
            ПРОБЛЕМА
          </button>
          <button className={`${styles.btn} ${styles.btnDone}`} onClick={() => openHandoff()}>
            ГОТОВО
          </button>
        </>
      )}
      {task.status === 'in_progress' && showProblemPicker && (
        <div className={styles.problemList}>
          {PROBLEM_TYPES.map(p => (
            <button key={p.code} className={styles.problemOption} onClick={() => handleBlock(p.code, p.label)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {task.status === 'blocked' && (
        <button
          className={`${styles.btn} ${styles.btnUnblock}`}
          onClick={() => unblockTask(task.id)}
        >
          РАЗБЛОКИРОВАТЬ
        </button>
      )}
    </div>
  );
}
