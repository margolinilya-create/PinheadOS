import styles from '../erp.module.css';

/**
 * Горизонтальный пайплайн фаз (редизайн, по UI Kit «Эксперимент»): соединённые узлы-фазы
 * со счётчиками и иконками — сколько разработок сейчас в каждой фазе. Активные (count>0) —
 * акцентные. Дополнительно справа — опциональный «боковой» узел (напр. возврат конструктору).
 */
export function Pipeline({ stages, aside }) {
  return (
    <div className={styles.pipeline}>
      {stages.map((s, i) => (
        <span key={s.key} className={styles.pipeNodeWrap}>
          <span className={`${styles.pipeNode} ${s.count > 0 ? styles.pipeNodeActive : ''}`}>
            <span className={styles.pipeCount}>{s.count}</span>
            <span className={styles.pipeLabel}>{s.icon ? `${s.icon} ` : ''}{s.label}</span>
          </span>
          {i < stages.length - 1 && <span className={styles.pipeArrow} aria-hidden="true">→</span>}
        </span>
      ))}
      {aside && aside.count > 0 && (
        <span className={`${styles.pipeNode} ${styles.pipeNodeAside}`}>
          <span className={styles.pipeCount}>{aside.count}</span>
          <span className={styles.pipeLabel}>{aside.icon ? `${aside.icon} ` : ''}{aside.label}</span>
        </span>
      )}
    </div>
  );
}
