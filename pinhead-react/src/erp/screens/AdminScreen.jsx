import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import EmployeesScreen from './EmployeesScreen';
import DepartmentsScreen from './DepartmentsScreen';
import { PermissionsTab } from './admin/PermissionsTab';
import { DictionariesTab } from './admin/DictionariesTab';
import { useErpAccess } from '../store/useErpAccess';
import { onTabListKeyDown } from '../utils/tabs';
import styles from '../erp.module.css';

const AdminPanel = React.lazy(() => import('../../components/auth/AdminPanel'));

/**
 * Единая админка обоих приложений (ERP + Order Studio).
 * Табы: Пользователи (общие profiles + цеховая привязка) · Права (матрица ролей,
 * правка 11) · Цеха (справочник участков с руководителем и нормативом) ·
 * Справочники (правка 12) · Заказы ТЗ (админ-таблица заказов Order Studio).
 */

/** `needs` — право матрицы, без которого вкладка не показывается */
const TABS = [
  { id: 'users', label: 'Пользователи' },
  { id: 'roles', label: 'Права' },
  { id: 'depts', label: 'Цеха', needs: 'catalog.edit' },
  { id: 'dicts', label: 'Справочники', needs: 'catalog.edit' },
  { id: 'studio', label: 'Заказы ТЗ' },
];

export default function AdminScreen() {
  const [params, setParams] = useSearchParams();
  const access = useErpAccess();
  // Право «Править справочники» гейтит вкладки цехов и справочников. Сегодня в админку
  // попадают только admin/director, у которых оно есть, — но право перестало быть
  // декоративным: снятое у роли, оно реально закрывает вкладку.
  const tabs = TABS.filter((t) => !t.needs || access.can(t.needs));
  const requested = params.get('tab') || 'users';
  const tab = tabs.some((t) => t.id === requested) ? requested : 'users';

  return (
    <>
      <PageHead
        title="Админка"
        sub="Общая для обоих режимов: пользователи и права, цеха, справочники, заказы Order Studio."
      />
      <div className={styles.deptTabs} role="tablist" aria-label="Разделы админки" onKeyDown={onTabListKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`admin-tab-${t.id}`}
            aria-controls="admin-tabpanel"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className={`${styles.deptTab} ${tab === t.id ? styles.deptTabActive : ''}`}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} tabIndex={-1}>
      {tab === 'users' && <EmployeesScreen embedded />}
      {tab === 'roles' && <PermissionsTab />}
      {tab === 'depts' && <DepartmentsScreen embedded />}
      {tab === 'dicts' && <DictionariesTab />}
      {tab === 'studio' && (
        <Suspense fallback={<TableSkeleton rows={5} label="Загрузка админки" />}>
          <AdminPanel ordersOnly />
        </Suspense>
      )}
      </div>
    </>
  );
}
