import { useDepartmentsStore } from '../../store/useDepartmentsStore';
import { PageHead } from '../components/PageHead';
import styles from '../erp.module.css';

export default function ErpDashboard() {
  const departments = useDepartmentsStore((s) => s.departments);

  return (
    <>
      <PageHead
        title="Обзор производства"
        sub="Прозрачность заказов и загрузки цехов. Данные подключим в Фазе 3–4."
      />
      <div className={styles.cardGrid}>
        {departments.map((d) => (
          <div key={d.code} className={styles.card}>
            <div className={styles.cardName}>
              {d.name}
              {d.branding && <span className={styles.badge}>брендирование</span>}
            </div>
            <div className={styles.cardMeta}>{d.type}</div>
            <div className={styles.cardMetric}>—</div>
          </div>
        ))}
      </div>
    </>
  );
}
