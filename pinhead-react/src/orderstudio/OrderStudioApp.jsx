import React, { useEffect, useState, Suspense } from 'react'
import { Routes, Route, Navigate, useBlocker, useParams } from 'react-router-dom'
import styles from '../App.module.css'
/**
 * Стили раздела. Лежат ЗДЕСЬ, а не в глобальном `styles/index.css`: раздел
 * стоит за флагом `orderStudio` и по умолчанию выключен, а его CSS —
 * 128 кБ сырого — ехал каждому, кто открыл только «Производство».
 * Оболочка ERP не использует из этих файлов ни одного класса.
 * Vite кладёт CSS ленивого чанка вместе с ним.
 */
/* forms-buttons ПЕРВЫМ среди файлов раздела: он и был первым в прежнем
   `styles/index.css`, а его правила перебиваются последующими той же
   специфичностью — порядок внутри чанка держит это как раньше */
import '../styles/forms-buttons.css'
import '../styles/wizard.css'
import '../styles/extras-zones.css'
/* kanban.css — остаток канбана v3: `.kanban-page` нужен ExpressCalc */
import '../styles/kanban.css'
import '../styles/express.css'
/* ПОСЛЕДНИМ: переопределяет базовые правила той же специфичности */
import '../styles/responsive.css'
import { useStore } from '../store/useStore'
import { storageRemove } from '../lib/storage'
import { lazyScreen } from '../erp/lazyScreen';
import {
  shouldBlockSalesLeave, salesHasUnsaved, salesLeaveDialogText, salesLeaveDialogTitle,
  shouldBlockCatalogLeave, catalogHasUnsaved, CATALOG_LEAVE_TEXT,
} from './leaveGuard'
import { useSalesStore } from './store/useSalesStore'
import { canManageOrderCatalogs, canManageSalesStaff, canSeeLaunchQueue, canUseSales, legacyRedirect } from './layout/orderNav'
import { switchToProduction } from './switchToProduction'
import OrderLayout from './layout/OrderLayout'

// PriceEditor is now embedded inside SkuEditor as the "Ценообразование" tab.
// /prices redirects to /sku?tab=pricing
const ExpressCalc = React.lazy(() => import('../components/editors/ExpressCalc'));
/**
 * Единая админка ERP смонтирована и здесь — значит и здесь она обязана
 * приехать вместе с доменными действиями стора (`lazyScreen`). Голый `lazy`
 * давал `/admin` в этом разделе экран со стором без половины действий:
 * «loadEmployees is not a function» вместо списка сотрудников.
 */
const AdminScreen = lazyScreen(() => import('../erp/screens/AdminScreen'));
const SkuEditor = React.lazy(() => import('../components/editors/SkuEditor'));
// Заказы v4: продавцы (`is_sales`), МС (`is_ms`) и руководство продаж — `canUseSales`
const SalesList = React.lazy(() => import('./screens/SalesList'));
// Рабочее место заказа (веха 3): изделия, клиент, ТЗ и цена — ленивый чанк
const OrderWorkplace = React.lazy(() => import('./workplace/OrderWorkplace'));
// «К запуску» (веха 6+7): экран МС — PDF ТЗ, оплата, маршрут, запуск в ERP; стор ERP — только по кнопке
const LaunchScreen = React.lazy(() => import('./launch/LaunchScreen'));
// Сотрудники продаж (вехи 3, 4): признаки is_sales и is_ms ставят admin, director, rop
const SalesStaff = React.lazy(() => import('./admin/SalesStaff'));
// Справочники заказа (веха 4): поставщики, бирки, упаковка, правила цены, подвал ТЗ — admin, director, rop
const OrderSettings = React.lazy(() => import('./admin/OrderSettings'));
/*
 * Agentation отсюда УБРАН и живёт в `components/shared/DevAnnotations`,
 * смонтированный один раз в `GlobalHosts` (`App.jsx`). Здесь он висел под
 * гейтом `isRealAdmin` и без проверки режима сборки, то есть 42 кБ gzip
 * инструмента разработки уезжали в прод (находка аудита 29.07, раздел D5:
 * комментарий «tree-shakes out of prod» коду не соответствовал).
 */

/**
 * Старт раздела: каталоги и уборка черновика визарда v3.
 *
 * ЗДЕСЬ — МОДУЛЬНАЯ ОБЛАСТЬ, А НЕ `main.jsx`: стор Order Studio со всеми
 * слайсами и каталогами ехал бы во входном чанке каждому, кто открыл только
 * «Производство» (там раздел выключен флагом). Код модуля выполняется один
 * раз — при загрузке чанка раздела, до его первого рендера.
 *
 * `pinhead_draft` — автосохранение визарда v3 (веха 3: визард убран, решение
 * владельца 17.10 — старые черновики из браузера удаляются). Удаляется РАЗОВО
 * при старте раздела; ключ остаётся и в `APP_KEYS` (выход), пометкой «наследие».
 */
storageRemove('pinhead_draft');
useStore.getState().loadCatalogs().catch(() => {});

/** Без доступа к заказам v4 — уход в «Производство» (один раз, без рендера маршрутов) */
function LeaveToProduction() {
  useEffect(() => { switchToProduction(); }, []);
  return <LoadingScreen />;
}

/**
 * Экран не для этой роли — в список заказов. До маршрутов доходят только те,
 * у кого `canUseSales` (остальных `OrderStudioApp` отправил в «Производство»),
 * а `/sales` открыт им всем — значит, петли редиректов нет.
 */
function RoleGuard({ allowed, children }) {
  if (!allowed) return <Navigate to="/sales" replace />;
  return children;
}

/** «К запуску» — только МС и руководству производства; прочим — карточка заказа */
function LaunchGuard({ allowed, children }) {
  const { id } = useParams();
  if (!allowed) return <Navigate to={`/sales/${id}`} replace />;
  // Ключ — id заказа: «Следующий к запуску» открывает экран заново, без итога и ошибки прежнего
  return <React.Fragment key={id}>{children}</React.Fragment>;
}

function LoadingScreen() {
  return (
    <div className={styles.loadingScreen}>
      <div className={styles.spinner} />
      <span className={styles.loadingLabel}>Загрузка...</span>
    </div>
  );
}

const Fallback = <div className="panel-loading">Загрузка...</div>;

/**
 * Раздел «ТЗ»: заказы v4, экспресс-расчёт, каталог и админка.
 * Показывается только при FEATURES.orderStudio === true.
 */
export default function OrderStudioApp({ user }) {
  // Профиль без продаж в раздел не входит: ни маршрутов, ни загрузки — сразу «Производство»
  if (!canUseSales(user)) return <LeaveToProduction />;
  return <OrderStudioShell user={user} />;
}

function OrderStudioShell({ user }) {
  const [catalogsReady, setCatalogsReady] = useState(false);
  // Состояние сохранения читается В МОМЕНТ перехода, а не из прошлого рендера.
  // Блокировщик у роутера один: он же спрашивает об уходе с несохранённым
  // справочником (`/order-settings`; смена `?tab=` — не уход, путь тот же)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldBlockSalesLeave({
    saveState: useSalesStore.getState().saveState,
    sending: useSalesStore.getState().sending,
    from: currentLocation.pathname,
    to: nextLocation.pathname,
  }) || shouldBlockCatalogLeave({ from: currentLocation.pathname, to: nextLocation.pathname }));

  useEffect(() => {
    useStore.getState().loadCatalogs().finally(() => setCatalogsReady(true));
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const { saveState, sending } = useSalesStore.getState();
      if (salesHasUnsaved(saveState, sending) || catalogHasUnsaved()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  if (!catalogsReady) {
    return <LoadingScreen />;
  }

  const isAdmin = ['admin', 'director'].includes(user.role);

  return (
    <>
      <OrderLayout user={user}>
      <Routes>
        <Route path="/" element={<Navigate to="/sales" replace />} />
        {/* Убраны канбан v3, аналитика продаж и печать v3 — закладки ведут в список заказов */}
        <Route path="/orders" element={<Navigate to={legacyRedirect('/orders')} replace />} />
        <Route path="/print" element={<Navigate to={legacyRedirect('/print')} replace />} />
        <Route path="/analytics" element={<Navigate to={legacyRedirect('/analytics')} replace />} />
        <Route path="/express" element={<Suspense fallback={Fallback}><ExpressCalc /></Suspense>} />
        <Route path="/prices" element={<Navigate to="/sku?tab=pricing" replace />} />
        <Route path="/sku" element={<RoleGuard allowed={isAdmin}><Suspense fallback={Fallback}><SkuEditor /></Suspense></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard allowed={isAdmin}><Suspense fallback={Fallback}><div className="container"><AdminScreen /></div></Suspense></RoleGuard>} />
        <Route path="/sales" element={<Suspense fallback={Fallback}><SalesList /></Suspense>} />
        <Route path="/sales/:id" element={<Suspense fallback={Fallback}><OrderWorkplace /></Suspense>} />
        <Route path="/sales/:id/launch" element={<LaunchGuard allowed={canSeeLaunchQueue(user)}><Suspense fallback={Fallback}><LaunchScreen /></Suspense></LaunchGuard>} />
        <Route path="/sales-staff" element={<RoleGuard allowed={canManageSalesStaff(user)}><Suspense fallback={Fallback}><SalesStaff /></Suspense></RoleGuard>} />
        <Route path="/order-settings" element={<RoleGuard allowed={canManageOrderCatalogs(user)}><Suspense fallback={Fallback}><OrderSettings /></Suspense></RoleGuard>} />
        {/* Неизвестный адрес и старый мастер позиции `/sales/:id/item/:key` — в список */}
        <Route path="*" element={<Navigate to="/sales" replace />} />
      </Routes>
      </OrderLayout>

      {/* Чей диалог — решает то, что держит правки: справочник или заказ */}
      {blocker.state === 'blocked' && (catalogHasUnsaved()
        ? <CatalogLeaveDialog blocker={blocker} />
        : <SalesLeaveDialog blocker={blocker} />)}
    </>
  );
}

/**
 * Диалог ухода с карточки v4. Подписка на состояние сохранения живёт только
 * пока диалог открыт — оболочка из-за неё не перерисовывается.
 */
function SalesLeaveDialog({ blocker }) {
  const saveState = useSalesStore((s) => s.saveState);
  const sending = useSalesStore((s) => s.sending);
  return (
    <div className={styles.blockerOverlay} role="dialog" aria-modal="true" aria-labelledby="blocker-title" aria-describedby="blocker-text">
      <div className={styles.blockerCard}>
        <div id="blocker-title" className={styles.blockerTitle}>{salesLeaveDialogTitle(sending)}</div>
        <div id="blocker-text" className={styles.blockerText}>
          {salesLeaveDialogText(saveState, sending)}
        </div>
        <div className={styles.blockerActions}>
          <button className="btn btn-primary" onClick={() => blocker.reset()}>
            Остаться
          </button>
          <button className="btn" onClick={() => blocker.proceed()}>
            Всё равно уйти
          </button>
        </div>
      </div>
    </div>
  );
}

/** Диалог ухода со «Справочников заказа» с несохранённым справочником */
function CatalogLeaveDialog({ blocker }) {
  return (
    <div className={styles.blockerOverlay} role="dialog" aria-modal="true" aria-labelledby="blocker-title" aria-describedby="blocker-text">
      <div className={styles.blockerCard}>
        <div id="blocker-title" className={styles.blockerTitle}>Правки справочника не сохранены</div>
        <div id="blocker-text" className={styles.blockerText}>{CATALOG_LEAVE_TEXT}</div>
        <div className={styles.blockerActions}>
          <button className="btn btn-primary" onClick={() => blocker.reset()}>
            Остаться
          </button>
          <button className="btn" onClick={() => blocker.proceed()}>
            Уйти без сохранения
          </button>
        </div>
      </div>
    </div>
  );
}
