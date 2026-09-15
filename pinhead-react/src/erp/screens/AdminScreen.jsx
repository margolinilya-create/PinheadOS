import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import EmployeesScreen from './EmployeesScreen';
import DepartmentsScreen from './DepartmentsScreen';
import { PermissionsTab } from './admin/PermissionsTab';
import { SkuCatalogTab } from './admin/SkuCatalogTab';
import { DictionariesTab } from './admin/DictionariesTab';
import { BypassTab } from './admin/BypassTab';
import { CapacityTab } from './admin/CapacityTab';
import { LegacySubcontractTab } from './admin/LegacySubcontractTab';
import { hasLegacySubcontracts } from '../utils/outsourcing';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { Tabs, TabPanel } from '../components/Tabs';

const AdminPanel = React.lazy(() => import('../../components/auth/AdminPanel'));

/**
 * Единая админка обоих приложений (ERP + Order Studio).
 * Табы: Пользователи (общие profiles + цеховая привязка) · Права (матрица ролей,
 * правка 11) · Цеха (справочник участков с руководителем и нормативом) ·
 * Мощность (общая мощность производства, правки 10.08) · Справочники (правка 12) ·
 * Аварийный режим (снятые проверки) · Подряд без маршрута (технический контур,
 * появляется только при наличии таких записей — правка 23.08, п. 5) ·
 * Заказы ТЗ (админ-таблица заказов Order Studio).
 */

/** `needs` — право матрицы, без которого вкладка не показывается */
/**
 * ВКЛАДКИ ГЕЙТЯТСЯ ПО ОТДЕЛЬНОСТИ, и с 15.09 это не педантизм, а условие:
 * маршрут `/admin` расширен с «роль admin/director» до «админ ИЛИ право
 * `sku.view`» (документ требует проверять доступ к каталогу отдельно
 * от прочей админки). Без `needs` у «Пользователей», «Прав» и «Заказов ТЗ»
 * это открыло бы управление сотрудниками всем, кто получил каталог, —
 * то есть менеджеру, закупщику и дизайнеру.
 */
const TABS = [
  { id: 'users', label: 'Пользователи', needs: 'staff.invite' },
  { id: 'roles', label: 'Права', needs: 'staff.invite' },
  { id: 'sku', label: 'Каталог SKU', needs: 'sku.view' },
  { id: 'depts', label: 'Цеха', needs: 'catalog.edit' },
  // Мощность производства (правки 10.08): право то же, что у самого плана —
  // мощность это часть планирования, а не отдельная сущность со своим правом
  { id: 'capacity', label: 'Мощность', needs: 'plan.manage' },
  { id: 'dicts', label: 'Справочники', needs: 'catalog.edit' },
  // Аварийный режим (правки 10.08): снять блокирующую проверку, когда она
  // останавливает работу из-за ошибки в системе
  { id: 'bypass', label: 'Аварийный режим', needs: 'bypass.manage' },
  // Технический контур (правка 23.08, п. 5): операции подряда без маршрута.
  // Вкладка заводится ТОЛЬКО когда такие записи есть — см. `hasLegacy` ниже
  { id: 'legacy', label: 'Подряд без маршрута', needs: 'order.manage', onlyWhenLegacy: true },
  { id: 'studio', label: 'Заказы ТЗ', needs: 'order.manage' },
];

export default function AdminScreen() {
  const [params, setParams] = useSearchParams();
  const access = useErpAccess();
  /**
   * Вкладка технического долга живёт РОВНО ПОКА ЕСТЬ ДОЛГ. Пустая вкладка
   * «Подряд без маршрута» врала бы о существовании работы; исчезая сама,
   * она делает то, что прежний блок в разделе «Подряд» только обещал.
   */
  const hasLegacy = useErpStore((s) => hasLegacySubcontracts(s.subcontracting));
  // Право «Править справочники» гейтит вкладки цехов и справочников. Сегодня в админку
  // попадают только admin/director, у которых оно есть, — но право перестало быть
  // декоративным: снятое у роли, оно реально закрывает вкладку.
  const tabs = TABS.filter((t) => (!t.needs || access.can(t.needs))
    && (!t.onlyWhenLegacy || hasLegacy));
  /**
   * ЗАПАСНАЯ ВКЛАДКА — ПЕРВАЯ ДОСТУПНАЯ, а не «Пользователи». С 15.09
   * в админку заходит и тот, у кого есть только каталог: жёсткий откат
   * на `users` дал бы ему пустую панель — вкладка отфильтрована, а активной
   * назначена именно она.
   */
  const requested = params.get('tab');
  const fallback = tabs[0]?.id ?? 'users';
  const tab = tabs.some((t) => t.id === requested) ? requested : fallback;

  return (
    <>
      <PageHead
        title="Админка"
        sub="Общая для обоих режимов: пользователи и права, цеха, справочники, заказы Order Studio."
      />
      <Tabs
        idPrefix="admin"
        label="Разделы админки"
        tabs={tabs}
        active={tab}
        onSelect={(id) => setParams({ tab: id }, { replace: true })}
      />

      <TabPanel idPrefix="admin" active={tab}>
      {tab === 'users' && <EmployeesScreen embedded />}
      {tab === 'roles' && <PermissionsTab />}
      {tab === 'sku' && <SkuCatalogTab />}
      {tab === 'depts' && <DepartmentsScreen embedded />}
      {tab === 'dicts' && <DictionariesTab />}
      {tab === 'capacity' && <CapacityTab />}
      {tab === 'bypass' && <BypassTab />}
      {tab === 'legacy' && <LegacySubcontractTab />}
      {tab === 'studio' && (
        <Suspense fallback={<TableSkeleton rows={5} label="Загрузка админки" />}>
          <AdminPanel ordersOnly />
        </Suspense>
      )}
      </TabPanel>
    </>
  );
}
