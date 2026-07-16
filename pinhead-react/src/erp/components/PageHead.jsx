import styles from '../erp.module.css';

export function PageHead({ title, sub }) {
  return (
    <div className={styles.pageHead}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {sub && <div className={styles.pageSub}>{sub}</div>}
    </div>
  );
}

export function Stub({ icon = '🚧', title, text, phase }) {
  return (
    <div className={styles.stub}>
      <div className={styles.stubIcon} aria-hidden="true">{icon}</div>
      <div>{title}</div>
      {text && <div style={{ marginTop: 6 }}>{text}</div>}
      {phase && <div className={styles.stubPhase}>{phase}</div>}
    </div>
  );
}
