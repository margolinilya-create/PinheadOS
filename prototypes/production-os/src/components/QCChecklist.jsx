import useWorkshopStore from '../store/useWorkshopStore';
import { QC_ITEMS } from '../data/workshops';
import styles from './QCChecklist.module.css';

export default function QCChecklist({ taskId }) {
  const qcChecklist = useWorkshopStore(s => s.qcChecklist);
  const toggleQCItem = useWorkshopStore(s => s.toggleQCItem);
  const isQCComplete = useWorkshopStore(s => s.isQCComplete);

  const taskChecks = qcChecklist[taskId] || {};
  const checkedCount = QC_ITEMS.filter(item => taskChecks[item.id]).length;
  const complete = isQCComplete(taskId);

  return (
    <div className={styles.root}>
      <div className={styles.title}>Чек-лист ОТК</div>

      <div className={styles.list}>
        {QC_ITEMS.map(item => {
          const checked = !!taskChecks[item.id];
          return (
            <div
              key={item.id}
              className={`${styles.item}${checked ? ' ' + styles.itemChecked : ''}`}
              onClick={() => toggleQCItem(taskId, item.id)}
            >
              <div className={styles.checkbox}>
                {checked && '✓'}
              </div>
              <div className={styles.text}>
                <div className={styles.label}>{item.label}</div>
                <div className={styles.desc}>{item.description}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.counter}>{checkedCount} из {QC_ITEMS.length} проверено</div>

      {complete && (
        <div className={styles.banner}>
          <span className={styles.bannerIcon}>✓</span>
          <span className={styles.bannerText}>ОТК пройден</span>
        </div>
      )}
    </div>
  );
}
