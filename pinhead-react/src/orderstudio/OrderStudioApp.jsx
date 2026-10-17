import React, { lazy, useEffect, useState, Suspense } from 'react'
import { Routes, Route, Navigate, useBlocker } from 'react-router-dom'
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
import '../styles/garment.css'
import '../styles/extras-zones.css'
/* kanban.css — остаток канбана v3: `.kanban-page` нужен ExpressCalc */
import '../styles/kanban.css'
import '../styles/express.css'
import '../styles/editors.css'
/* ПОСЛЕДНИМ: переопределяет базовые правила той же специфичности */
import '../styles/responsive.css'
import { useStore } from '../store/useStore'
import ProgressBar from '../components/layout/ProgressBar'
import StepGarment from '../components/steps/StepGarment'

// Lazy-load wizard steps 2-5 (rendered only when user advances)
import { lazyScreen } from '../erp/lazyScreen';
const StepDesign = lazy(() => import('../components/steps/StepDesign'));
const StepItems = lazy(() => import('../components/steps/StepItems'));
const StepDetails = lazy(() => import('../components/steps/StepDetails'));
const StepSummary = lazy(() => import('../components/steps/StepSummary'));
import { shouldBlockLeave, shouldBlockSalesLeave, salesHasUnsaved } from './leaveGuard'
import { useSalesStore } from './store/useSalesStore'
import { legacyRedirect } from './layout/orderNav'
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
// Order v4 (срез 1) — пилот владельца, admin/director
const SalesList = React.lazy(() => import('./screens/SalesList'));
const SalesCard = React.lazy(() => import('./screens/SalesCard'));
const ItemWizard = React.lazy(() => import('./screens/ItemWizard'));
/*
 * Agentation отсюда УБРАН и живёт в `components/shared/DevAnnotations`,
 * смонтированный один раз в `GlobalHosts` (`App.jsx`). Здесь он висел под
 * гейтом `isRealAdmin` и без проверки режима сборки, то есть 42 кБ gzip
 * инструмента разработки уезжали в прод (находка аудита 29.07, раздел D5:
 * комментарий «tree-shakes out of prod» коду не соответствовал).
 */

/**
 * Старт раздела: черновик визарда и каталоги.
 *
 * ЖИЛО В `main.jsx` — под проверкой `if (FEATURES.orderStudio)`, но с обычным
 * импортом стора наверху файла. Проверка рантайм, импорт статический: стор
 * Order Studio со всеми слайсами, весь `src/data` (SKU, цвета, ткани, цены,
 * обработки), `utils/pricing` и `lib/catalogs` ехали ВО ВХОДНОМ ЧАНКЕ — то есть
 * каждому, кто открыл «Производство», где этот раздел выключен флагом и не
 * используется ни одной строкой. Ровно тот же класс отказа, что был у CSS
 * Order Studio 22.08: условие в коде есть, а в графе сборки его нет.
 *
 * ЗДЕСЬ — МОДУЛЬНАЯ ОБЛАСТЬ, А НЕ `useEffect`. Эффект выполняется ПОСЛЕ первого
 * рендера: визард успел бы отрисоваться с пустой формой и заполниться следом,
 * то есть черновик мигал бы на глазах. Код модуля выполняется при загрузке
 * чанка раздела, до его первого рендера, — тот же момент, что и в `main.jsx`.
 */
try {
  const draft = localStorage.getItem('pinhead_draft');
  if (draft) useStore.getState().restoreFromDraft(JSON.parse(draft));
} catch {
  // Битый черновик убираем: иначе он ломает восстановление при каждом старте
  localStorage.removeItem('pinhead_draft');
}
useStore.getState().loadCatalogs().catch(() => {});

const STEPS = [StepGarment, StepDesign, StepItems, StepDetails, StepSummary];

// Wizard page — main step-based flow
function WizardPage() {
  const step = useStore(s => s.step);
  const CurrentStep = STEPS[step] || StepGarment;
  return (
    <>
      <ProgressBar />
      <div className="container">
        <Suspense fallback={<div className="panel-loading">Загрузка...</div>}>
          <CurrentStep />
        </Suspense>
      </div>
    </>
  );
}

// Role guard — redirects to / if role doesn't match
function RoleGuard({ allowed, children }) {
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div className={styles.loadingScreen}>
      <div className={styles.spinner} />
      <span className={styles.loadingLabel}>Загрузка...</span>
    </div>
  );
}

/**
 * Order Studio — визард оформления заказа + цены (заархивировано за feature-flag).
 * Показывается только при FEATURES.orderStudio === true.
 */
export default function OrderStudioApp({ user }) {
  const [catalogsReady, setCatalogsReady] = useState(false);
  // Состояние визарда читается В МОМЕНТ перехода, а не из прошлого рендера:
  // «Оформить как заказ v4» сбрасывает визард и тут же уходит в карточку —
  // замыкание рендера ещё видело шаг 4 и показывало «Заказ не сохранён»
  // (поймано обходом в браузере)
  const [leaveReason, setLeaveReason] = useState('wizard');
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const { step, saved } = useStore.getState();
    const from = currentLocation.pathname;
    const to = nextLocation.pathname;
    if (shouldBlockSalesLeave({ saveState: useSalesStore.getState().saveState, from, to })) {
      setLeaveReason('sales');
      return true;
    }
    setLeaveReason('wizard');
    return shouldBlockLeave({ step, saved, from, to });
  });

  useEffect(() => {
    useStore.getState().loadCatalogs().finally(() => setCatalogsReady(true));
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const { step, saved } = useStore.getState();
      if ((step > 0 && !saved) || salesHasUnsaved(useSalesStore.getState().saveState)) {
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

  const role = user.role;
  const isAdmin = ['admin', 'director'].includes(role);
  const isProduction = role === 'production';
  const isDesigner = role === 'designer';
  const canEdit = !isProduction && !isDesigner;

  return (
    <>
      <OrderLayout user={user}>
      <Routes>
        <Route path="/" element={<WizardPage />} />
        {/* Убраны канбан v3, аналитика продаж и печать v3 — закладки ведут на рабочие экраны */}
        <Route path="/orders" element={<Navigate to={legacyRedirect('/orders', role)} replace />} />
        <Route path="/print" element={<Navigate to={legacyRedirect('/print', role)} replace />} />
        <Route path="/analytics" element={<Navigate to={legacyRedirect('/analytics', role)} replace />} />
        <Route path="/express" element={<RoleGuard allowed={canEdit}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><ExpressCalc /></Suspense></RoleGuard>} />
        <Route path="/prices" element={<Navigate to="/sku?tab=pricing" replace />} />
        <Route path="/sku" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><SkuEditor /></Suspense></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><div className="container"><AdminScreen /></div></Suspense></RoleGuard>} />
        <Route path="/sales" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><SalesList /></Suspense></RoleGuard>} />
        <Route path="/sales/:id" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><SalesCard /></Suspense></RoleGuard>} />
        <Route path="/sales/:id/item/:key" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><ItemWizard /></Suspense></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </OrderLayout>

      {blocker.state === 'blocked' && (
        <div className={styles.blockerOverlay} role="dialog" aria-modal="true" aria-labelledby="blocker-title">
          <div className={styles.blockerCard}>
            <div id="blocker-title" className={styles.blockerTitle}>
              {leaveReason === 'sales' ? 'Правки заказа v4 не сохранены' : 'Заказ не сохранён'}
            </div>
            <div className={styles.blockerText}>
              {leaveReason === 'sales'
                ? 'Последнее сохранение не удалось. Если уйти сейчас, правки потеряются — останьтесь и повторите после восстановления связи.'
                : 'Если уйти сейчас — черновик сохранится, но несохранённые изменения потеряются.'}
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
      )}
    </>
  );
}
