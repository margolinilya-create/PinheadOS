import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import EmployeesScreen from './EmployeesScreen';
import DepartmentsScreen from './DepartmentsScreen';
import styles from '../erp.module.css';

const AdminPanel = React.lazy(() => import('../../components/auth/AdminPanel'));

/**
 * Единая админка обоих приложений (ERP + Order Studio).
 * Табы: Пользователи (общие profiles + цеховая привязка) · Цеха · Заказы ТЗ
 * (админ-таблица заказов Order Studio).
 */

const TABS = [
  { id: 'users', label: 'Пользователи' },
  { id: 'depts', label: 'Цеха' },
  { id: 'studio', label: 'Заказы ТЗ' },
];

export default function AdminScreen() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'users';

  return (
    <>
      <PageHead
        title="Админка"
        sub="Общая для обоих режимов: пользователи и роли, цеха, заказы Order Studio."
      />
      <div className={styles.deptTabs} role="tablist" aria-label="Разделы админки">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.deptTab} ${tab === t.id ? styles.deptTabActive : ''}`}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && <EmployeesScreen embedded />}
      {tab === 'depts' && <DepartmentsScreen embedded />}
      {tab === 'studio' && (
        <Suspense fallback={<TableSkeleton rows={5} label="Загрузка админки" />}>
          <AdminPanel ordersOnly />
        </Suspense>
      )}
    </>
  );
}
