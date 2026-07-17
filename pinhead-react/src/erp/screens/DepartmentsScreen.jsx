import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { PageHead } from '../components/PageHead';
import styles from '../erp.module.css';

export default function DepartmentsScreen({ embedded = false }) {
  const { departments, loaded, loadAll } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
    })),
  );

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  return (
    <>
      {!embedded && (
        <PageHead
          title="Цеха и участки"
          sub={`${departments.length} подразделений — общий справочник производства.`}
        />
      )}
      <div className={styles.cardGrid}>
        {departments.map((d) => (
          <div key={d.id} className={styles.card} style={d.active ? undefined : { opacity: 0.5 }}>
            <div className={styles.cardName}>
              {d.name}
              {d.is_branding && <span className={styles.badge}>брендирование</span>}
            </div>
            <div className={styles.cardMeta}>
              {d.code}{d.active ? '' : ' · отключён'}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
