import { useEffect, Suspense } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import ErrorBoundary from '../components/shared/ErrorBoundary';
import ErpLayout from './layout/ErpLayout';
import { ScreenSkeleton } from './components/ErpSkeletons';
import { LoadFailed, ScreenOutdated } from './components/ErpStates';
import { Icon } from './components/Icon';
import { FEATURES } from '../config/features';
import { useErpAccess } from './store/useErpAccess';
import { canOpenScreen } from './utils/screenAccess';
import { ensureDomainSlices, lazyScreen } from './lazyScreen';
import styles from './erp.module.css';

/**
 * ВСЕ экраны — отдельные чанки, включая три первых. Заводятся `lazyScreen`,
 * а не голым `lazy`: вместе с экраном приезжают доменные действия стора
 * (см. store/domainSlices) — иначе первый же экран получил бы стор без
 * половины действий.
 *
 * Обзор, заказы и очередь цеха оставались статикой ради «без мигания на первом
 * экране», и это стоило оболочке 125 кБ (37 кБ gzip): их код ехал каждому и
 * всегда — в том числе рабочему, который открывает только свой цех, и с
 * планшета по цеховому Wi-Fi. Скелетоны у экранов есть, а `prefetchScreens`
 * ниже подтягивает соседние сразу после первой отрисовки: к моменту, когда
 * человек нажмёт на пункт меню, чанк уже в кэше.
 */
const ErpDashboard = lazyScreen(() => import('./screens/ErpDashboard'));
const OrdersScreen = lazyScreen(() => import('./screens/OrdersScreen'));
const DepartmentQueue = lazyScreen(() => import('./screens/DepartmentQueue'));
const OrderCard = lazyScreen(() => import('./screens/OrderCard'));
const ProductionBoard = lazyScreen(() => import('./screens/ProductionBoard')); // + ErpKanban в чанке
const AdminScreen = lazyScreen(() => import('./screens/AdminScreen')); // + Employees/Departments
const ProductionTask = lazyScreen(() => import('./screens/ProductionTask'));
const FabricPurchasing = lazyScreen(() => import('./screens/FabricPurchasing'));
const PurchaseListPrint = lazyScreen(() => import('./screens/purchasing/PurchaseListPrint'));
const Warehouse = lazyScreen(() => import('./screens/Warehouse'));
const Subcontracting = lazyScreen(() => import('./screens/Subcontracting'));
const Experimental = lazyScreen(() => import('./screens/Experimental'));
const DevPage = lazyScreen(() => import('./screens/DevPage'));
const DeptLoad = lazyScreen(() => import('./screens/DeptLoad'));
const PlanScreen = lazyScreen(() => import('./screens/PlanScreen'));
// Витрина дизайн-системы — за флагом `styleguide`, отдельным чанком.
// Ленивый импорт обязателен: иначе список всех иконок и демо-разметка
// уехали бы в оболочку, которую грузят все и всегда.
const StyleGuide = lazyScreen(() => import('./screens/StyleGuide'));

/**
 * Предзагрузка соседних экранов в простое.
 *
 * Ленивый экран экономит критический путь, но переносит ожидание на первый
 * переход — на цеховом планшете это заметно. Поэтому после первой отрисовки,
 * когда браузер свободен, тянем то, куда человек пойдёт почти наверняка:
 * обзор, заказы и свой цех. Это НЕ критический путь — оболочка к этому моменту
 * уже интерактивна, а промахи глушим: неудачная предзагрузка не должна
 * всплывать ошибкой, обычный переход просто подождёт чанк.
 */
const PREFETCH = [
  // Доменные действия стора — общий чанк всех экранов, поэтому первым
  ensureDomainSlices,
  () => import('./screens/ErpDashboard'),
  () => import('./screens/OrdersScreen'),
  () => import('./screens/DepartmentQueue'),
];

function usePrefetchScreens() {
  useEffect(() => {
    const run = () => PREFETCH.forEach((load) => { load().catch(() => {}); });
    // requestIdleCallback есть не везде (Safari) — там просто небольшая пауза
    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') {
      const id = idle(run, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 1200);
    return () => clearTimeout(t);
  }, []);
}

/**
 * Кей по orderId → свежий инстанс карточки на каждый заказ: при переходе A→B страница
 * ремонтируется, useOrderDetail стартует с чистого стейта (без мигания данных прошлого заказа).
 * Единственная карточка заказа: боковая панель убрана правкой заказчика 16.08.
 */
function OrderCardRoute() {
  const { orderId } = useParams();
  return <OrderCard key={orderId} />;
}

/** То же для задания: переход A→B ремонтирует страницу, без мигания прошлых данных */
function ProductionTaskRoute() {
  const { stageId } = useParams();
  return <ProductionTask key={stageId} />;
}

/** Инлайн-панель «нет доступа» — без redirect, чтобы избежать гонки с загрузкой роли */
function ErpGuard({ allowed, children }) {
  if (!allowed) {
    return (
      <div className={styles.noAccess}>
        <div className={styles.stubIcon} aria-hidden="true"><Icon name="ban" size={34} /></div>
        <div>Нет доступа к этому разделу</div>
      </div>
    );
  }
  return children;
}

export default function ErpApp({ user }) {
  const { pathname } = useLocation();
  // Админка остаётся за учётной записью: это настройка системы, а не работа
  const isAdmin = ['admin', 'director'].includes(user?.role);
  /**
   * Разделы «Операции» открываются ПРАВОМ, а не типом учётной записи.
   * Иначе выданное право недостижимо: кладовщик с `warehouse.manage`
   * не видел пункта «Склад» и не мог открыть адрес. Список — в screenAccess,
   * один и тот же для маршрута и для меню.
   */
  usePrefetchScreens();
  const { can } = useErpAccess();
  const canOpen = (path) => canOpenScreen(can, path);

  return (
    <ErpLayout user={user}>
      {/* key={pathname}: падение одного экрана не роняет всю оболочку, а уход
          в другой раздел пересоздаёт границу — экран восстанавливается сам. */}
      <ErrorBoundary
        key={pathname}
        fallback={(error, reset, { isUpdate } = {}) => (isUpdate
          // Устаревшая вкладка после выкатки — не поломка приложения и не отказ
          // связи: чанк экрана исчез по своему адресу. «Повторить» здесь бессилен
          ? <ScreenOutdated />
          : <LoadFailed what={`экран (${error?.message || 'непредвиденная ошибка'})`} onRetry={reset} />
        )}
      >
        <Suspense fallback={<ScreenSkeleton />}>
          <Routes>
          <Route path="/" element={<ErpDashboard />} />
          <Route path="/orders" element={<OrdersScreen />} />
          <Route path="/orders/:orderId" element={<OrderCardRoute />} />
          <Route path="/load" element={<DeptLoad />} />
          {/* Недельный и ежедневный план производства (правка менеджера 2026-08-03) */}
          <Route path="/plan" element={<PlanScreen />} />
          <Route path="/board" element={<ProductionBoard />} />
          {/* /queue — «Мой цех» (автопривязка), /queue/:deptCode — очередь конкретного участка */}
          <Route path="/queue" element={<DepartmentQueue />} />
          <Route path="/queue/:deptCode" element={<DepartmentQueue />} />
          {/* Страница производственного задания (правка 5); key — свежий инстанс на задание */}
          <Route path="/task/:stageId" element={<ProductionTaskRoute />} />
          <Route path="/admin" element={<ErpGuard allowed={isAdmin}><AdminScreen /></ErpGuard>} />
          <Route path="/employees" element={<Navigate to="/admin?tab=users" replace />} />
          <Route path="/departments" element={<Navigate to="/admin?tab=depts" replace />} />
          <Route path="/purchasing" element={<ErpGuard allowed={canOpen('/purchasing')}><FabricPurchasing /></ErpGuard>} />
          {/* Печатный лист закупки заказа. Гейта нет намеренно: это представление
              данных самого заказа, а карточку заказа видят все — закрывать печать
              строже, чем экран, откуда её открывают, значит показать кнопку,
              которая отвечает отказом. */}
          <Route path="/orders/:orderId/purchase-list" element={<PurchaseListPrint />} />
          <Route path="/warehouse" element={<ErpGuard allowed={canOpen('/warehouse')}><Warehouse /></ErpGuard>} />
          <Route path="/subcontracting" element={<ErpGuard allowed={canOpen('/subcontracting')}><Subcontracting /></ErpGuard>} />
          <Route path="/experimental" element={<ErpGuard allowed={canOpen('/experimental')}><Experimental /></ErpGuard>} />
          {/* Карточка разработки — СТРАНИЦА, а не шторка (правка 22.08, п. 4.11).
              Гейт тот же, что у раздела: `canOpenScreen` сравнивает первый
              сегмент пути, иначе подстраница была бы «незнакомым путём»,
              то есть открытой всем */}
          <Route
            path="/experimental/:devId"
            element={<ErpGuard allowed={canOpen('/experimental')}><DevPage /></ErpGuard>}
          />
          {/* Инструмент разработки, не раздел ERP: в меню нет, по умолчанию выключен */}
          {FEATURES.styleguide && <Route path="/styleguide" element={<StyleGuide />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </ErpLayout>
  );
}
