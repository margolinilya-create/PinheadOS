import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import EmployeesScreen from './EmployeesScreen';
import DepartmentsScreen from './DepartmentsScreen';
import { PermissionsTab } from './admin/PermissionsTab';
import { DictionariesTab } from './admin/DictionariesTab';
import styles from '../erp.module.css';

const AdminPanel = React.lazy(() => import('../../components/auth/AdminPanel'));

/**
 * Единая админка обоих приложений (ERP + Order Studio).
 * Табы: Пользователи (общие profiles + цеховая привязка) · Права (матрица ролей,
 * правка 11) · Цеха (справочник участков с руководителем и нормативом) ·
 * Справочники (правка 12) · Заказы ТЗ (админ-таблица заказов Order Studio).
 */

const TABS = [
  { id: 'users', label: 'Пользователи' },
  { id: 'roles', label: 'Права' },
  { id: 'depts', label: 'Цеха' },
  { id: 'dicts', label: 'Справочники' },
  { id: 'studio', label: 'Заказы ТЗ' },
];

export default function AdminScreen() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'users';

  return (
    <>
      <PageHead
        title="Админка"
        sub="Общая для обоих режимов: пользователи и права, цеха, справочники, заказы Order Studio."
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
      {tab === 'roles' && <PermissionsTab />}
      {tab === 'depts' && <DepartmentsScreen embedded />}
      {tab === 'dicts' && <DictionariesTab />}
      {tab === 'studio' && (
        <Suspense fallback={<TableSkeleton rows={5} label="Загрузка админки" />}>
          <AdminPanel ordersOnly />
        </Suspense>
      )}
    </>
  );
}
