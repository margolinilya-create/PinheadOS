import { useDepartmentsStore } from '../../store/useDepartmentsStore';
import { PageHead } from '../components/PageHead';
import styles from '../erp.module.css';

export default function DepartmentsScreen() {
  const departments = useDepartmentsStore((s) => s.departments);

  return (
    <>
      <PageHead
        title="Цеха и участки"
        sub={`${departments.length} подразделений. CRUD подключим в Фазе 1.`}
      />
      <div className={styles.cardGrid}>
        {departments.map((d) => (
          <div key={d.code} className={styles.card}>
            <div className={styles.cardName}>
              {d.name}
              {d.branding && <span className={styles.badge}>брендирование</span>}
            </div>
            <div className={styles.cardMeta}>
              {d.code} · {d.type}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
