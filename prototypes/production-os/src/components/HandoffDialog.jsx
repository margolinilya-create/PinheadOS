import { useState } from 'react';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOP_MAP, ROUTE_TEMPLATES } from '../data/workshops';
import styles from './HandoffDialog.module.css';

export default function HandoffDialog() {
  const [note, setNote] = useState('');

  const selectedTaskId = useWorkshopStore(s => s.selectedTaskId);
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);
  const completeTask = useWorkshopStore(s => s.completeTask);
  const closeTask = useWorkshopStore(s => s.closeTask);

  const task = tasks.find(t => t.id === selectedTaskId);
  if (!task) return null;

  const order = orders[task.order_id];
  const route = order ? ROUTE_TEMPLATES[order.route] : [];
  const currentIdx = route.indexOf(task.workshop_code);
  const nextWorkshopCode = currentIdx >= 0 && currentIdx < route.length - 1
    ? route[currentIdx + 1]
    : null;
  const nextWs = nextWorkshopCode ? WORKSHOP_MAP[nextWorkshopCode] : null;
  const isLastOp = !nextWorkshopCode;

  function handleConfirm() {
    completeTask(selectedTaskId, note.trim() || null);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) closeTask();
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          {isLastOp
            ? 'Готово! Заказ завершён!'
            : `Готово! Передать в ${nextWs ? nextWs.name : nextWorkshopCode}?`
          }
        </div>

        {!isLastOp && (
          <div className={styles.body}>
            <textarea
              className={styles.textarea}
              placeholder={nextWs ? `Заметка для ${nextWs.name}...` : 'Заметка для следующего цеха...'}
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              autoFocus
            />
          </div>
        )}

        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnCancel}`} onClick={closeTask}>
            ОТМЕНА
          </button>
          <button className={`${styles.btn} ${styles.btnConfirm}`} onClick={handleConfirm}>
            {isLastOp ? 'ЗАВЕРШИТЬ' : 'ПЕРЕДАТЬ'}
          </button>
        </div>
      </div>
    </div>
  );
}
