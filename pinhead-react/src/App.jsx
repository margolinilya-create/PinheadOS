import React, { useEffect, Suspense } from 'react'
import './styles/index.css'
import styles from './App.module.css'
import { useShallow } from 'zustand/react/shallow'
import AuthScreen from './components/auth/AuthScreen'
import { useAuthStore } from './store/useAuthStore'
import ErrorBoundary from './components/shared/ErrorBoundary'
import ToastContainer from './components/shared/Toast'
import ConfirmDialogHost from './components/shared/ConfirmDialogHost'
import DevAnnotations from './components/shared/DevAnnotations'
import { FEATURES } from './config/features'
import { JOIN_PATH } from './erp/utils/invite'

// Order Studio (визард/цены) — заархивирован за feature-flag, грузится только при включении.
const OrderStudioApp = React.lazy(() => import('./orderstudio/OrderStudioApp'))
// Внутреннее ERP — новый корень приложения.
const ErpApp = React.lazy(() => import('./erp/ErpApp'))
/**
 * Приглашение по ссылке. Ленивый: экран открывают один раз в жизни сотрудника,
 * а тянет он словарь ролей ERP — во входном чанке ему делать нечего.
 */
const JoinScreen = React.lazy(() => import('./components/auth/JoinScreen'))
/** Смена пароля по ссылке из письма — открывается один раз и редко */
const NewPasswordScreen = React.lazy(() => import('./components/auth/NewPasswordScreen'))

function LoadingScreen() {
  return (
    <div className={styles.loadingScreen}>
      <div className={styles.spinner} />
      <span className={styles.loadingLabel}>Загрузка...</span>
    </div>
  );
}

/**
 * Хосты, нужные на любом экране. `DevAnnotations` (визуальная обратная связь
 * агенту, agentation.com) стоит ЗДЕСЬ, а не в оболочке раздела: замечание
 * одинаково нужно и в «Производстве», и в Order Studio, и на экранах входа,
 * а две точки монтирования — это два условия показа, которые разъедутся.
 * В прод-сборке компонент вырождается в `null` вместе со своим чанком.
 */
function GlobalHosts() {
  return (
    <>
      <ToastContainer />
      <ConfirmDialogHost />
      <DevAnnotations />
    </>
  );
}

/**
 * Стена: доступа нет, работать нельзя, объяснение и выход.
 *
 * Разметка была в двух экземплярах, а стилей у неё не было НИ ОДНОГО — классы
 * `pending-*` не объявлены ни в одном css-файле проекта (остались от прежнего
 * html-прототипа). Человек упирался в нестилизованный текст с нативной серой
 * кнопкой и читал это как поломку сайта, а не как сообщение.
 */
function AccessWall({ icon, title, children, email, actions }) {
  return (
    <div id="pendingScreen" className="show">
      <div className="pending-box">
        <div className="pending-icon">{icon}</div>
        <div className="pending-title">{title}</div>
        <p className="pending-desc">{children}</p>
        <p className="pending-email">{email}</p>
        <div className="pending-actions">
          {actions}
          <button className="pending-logout" onClick={() => useAuthStore.getState().logout()}>Выйти</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { user, initializing, init, profileStatus, checkingProfile, passwordRecovery } = useAuthStore(useShallow(s => ({
    user: s.user,
    initializing: s.initializing,
    init: s.init,
    profileStatus: s.profileStatus,
    checkingProfile: s.checkingProfile,
    passwordRecovery: s.passwordRecovery,
  })));

  /**
   * Путь читается НАПРЯМУЮ, а не через `useLocation()`.
   *
   * `useLocation()` подписывает App на каждый переход — и этого достаточно,
   * чтобы сломать выбор оболочки. `FEATURES.orderStudio` — геттер, читающий
   * `?studio=` из адреса; внутренние ссылки параметр не несут. Пока App
   * не перерисовывался на переходах, режим вычислялся один раз за загрузку;
   * с подпиской первый же переход внутри производства открывал Order Studio.
   * Поймали e2e: 8 сценариев навигации, очереди, плана и вкладок.
   *
   * Подписка приглашению и не нужна: на `/join` приходят по ссылке извне,
   * то есть новой загрузкой страницы, а внутри приложения на этот адрес
   * не переходят ниоткуда.
   */
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

  useEffect(() => {
    init();
  }, [init]);

  /**
   * Пустой экран загрузки — ТОЛЬКО на первичную проверку сессии.
   *
   * Здесь стоял общий `loading` авторизации, который поднимает КАЖДЫЙ вход и
   * КАЖДАЯ регистрация. На время запроса App подменял форму глобальным
   * «Загрузка…», а по возвращении монтировал её ЗАНОВО: локальное состояние
   * экрана обнулялось. На приглашении из-за этого не показывалось объяснение
   * «такой сотрудник уже заведён» — исход приходил в размонтированный
   * компонент; на форме входа после неудачной попытки очищался набранный
   * адрес. Кнопки при этом свои состояния («Вход…», «Создаём доступ…») имеют
   * и показать их не могли — экрана в этот момент не существовало.
   */
  if (initializing) {
    return <LoadingScreen />;
  }

  /**
   * Пришли по ссылке восстановления пароля.
   *
   * Проверка стоит ПЕРЕД пользователем намеренно: ссылка уже вошла человека
   * в систему, и без этой ветки он попал бы прямо в рабочую оболочку, так
   * и не задав пароль, — то есть в следующий раз пришёл бы за новой ссылкой.
   */
  if (passwordRecovery) {
    return (
      <>
        <Suspense fallback={<LoadingScreen />}>
          <NewPasswordScreen />
        </Suspense>
        <GlobalHosts />
      </>
    );
  }

  if (!user) {
    /**
     * Пришли по приглашению — форма входа не нужна: у человека ещё нет ни
     * пароля, ни учётной записи, а есть ссылка, в которой уже записаны его
     * роль и цех. Отдельного маршрута не заводим: до входа приложение
     * не показывает ни одного экрана, кроме этих двух.
     */
    if (pathname === JOIN_PATH) {
      return (
        <>
          <Suspense fallback={<LoadingScreen />}>
            <JoinScreen />
          </Suspense>
          <GlobalHosts />
        </>
      );
    }
    return (
      <>
        {/*
          * Форма входа СТАТИЧЕСКАЯ, и это решение, а не недосмотр.
          *
          * Ленивой она была ровно один заход: экономия ~3 кБ во входном чанке
          * против правила «пустой экран загрузки — только на первичную проверку
          * сессии». Правило сторожит `App.test.jsx`, и он сразу покраснел:
          * при промахе прогрева (приватный режим, очищенное хранилище,
          * первый визит) человек упирается в «Загрузка…» вместо формы — то есть
          * ровно в тот симптом, из-за которого правило и появилось.
          */}
        <AuthScreen />
        <GlobalHosts />
      </>
    );
  }

  /**
   * Отключённый аккаунт (soft-delete `active=false`) обязан упираться в стену.
   * `fetchProfile` вычислял `profileStatus: 'disabled'` с самого начала, но здесь
   * проверялся только `approved`, и отключённому рендерилась полная оболочка.
   * Клиент — вторая линия: первая это RLS, где `is_admin()` теперь тоже смотрит
   * на `active`/`approved`. Но пока живой refresh-токен не отозван, стена в
   * интерфейсе — то, что человек видит первым.
   */
  if (profileStatus === 'disabled') {
    return (
      <>
        <AccessWall icon="🔒" title="Доступ отключён" email={user.email}>
          Ваш аккаунт отключён администратором. Если это ошибка — обратитесь к руководителю.
        </AccessWall>
        <GlobalHosts />
      </>
    );
  }

  if (user.approved === false) {
    return (
      <>
        <AccessWall
          icon="⏳"
          title="Ожидание подтверждения"
          email={user.email}
          /**
           * «Проверить снова» вместо F5: админ одобряет доступ в своей вкладке,
           * а эта об этом не узнаёт — подписки на собственный профиль нет.
           * Человек сидел на стене уже одобренным и ждал того, что сделано.
           */
          actions={(
            <button
              className="pending-recheck"
              onClick={() => useAuthStore.getState().refreshProfile()}
              disabled={checkingProfile}
            >
              {checkingProfile ? 'Проверяем...' : 'Проверить снова'}
            </button>
          )}
        >
          Ваш аккаунт ещё не подтверждён администратором. Как только доступ откроют,
          нажмите «Проверить снова».
        </AccessWall>
        <GlobalHosts />
      </>
    );
  }

  const Shell = FEATURES.orderStudio ? OrderStudioApp : ErpApp;

  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        <Shell user={user} />
      </Suspense>
      <GlobalHosts />
    </>
  );
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
