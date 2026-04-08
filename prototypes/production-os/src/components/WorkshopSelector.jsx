import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOPS } from '../data/workshops';
import styles from './WorkshopSelector.module.css';

export default function WorkshopSelector() {
  const currentWorkshop = useWorkshopStore(s => s.currentWorkshop);
  const setWorkshop = useWorkshopStore(s => s.setWorkshop);
  const tasks = useWorkshopStore(s => s.tasks);

  return (
    <div className={styles.selector}>
      {WORKSHOPS.map(w => {
        const active = w.code === currentWorkshop;
        const count = tasks.filter(t => t.workshop_code === w.code && t.status !== 'done').length;

        return (
          <button
            key={w.code}
            className={`${styles.tab}${active ? ' ' + styles.tabActive : ''}`}
            onClick={() => setWorkshop(w.code)}
            style={{ '--ws-color': w.color }}
          >
            <span className={styles.dot} style={active ? {} : { background: w.color }} />
            <span className={styles.name}>{w.name}</span>
            {count > 0 && (
              <span
                className={styles.badge}
                style={{ background: active ? w.color : 'var(--border-light)', color: active ? '#fff' : 'var(--text-mid)' }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
