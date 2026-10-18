import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './store/useAuthStore';
import { setFeature, clearFeature } from './config/features';
import { switchToProduction } from './orderstudio/switchToProduction';
import { supabase } from './lib/supabase';

// Настоящий выход (чистка хранилища) — до того, как beforeEach подменит его заглушкой
const realLogout = useAuthStore.getState().logout;

// Mock catalogs loader
vi.mock('./lib/catalogs', () => ({
  loadAllCatalogs: vi.fn().mockResolvedValue({}),
}));

// Mock supabase
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
    channel: vi.fn(() => {
      const ch = { on: vi.fn(() => ch), subscribe: vi.fn(() => ch) };
      return ch;
    }),
    removeChannel: vi.fn(async () => 'ok'),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({}),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

// Mock agentation
vi.mock('agentation', () => ({
  Agentation: () => null,
}));

// Переход в «Производство» перезагружает страницу — в jsdom навигации нет
vi.mock('./orderstudio/switchToProduction', () => ({ switchToProduction: vi.fn() }));

// Mock pricing
vi.mock('./utils/pricing', () => ({
  calcTotal: vi.fn(() => 0),
  getTotalQty: vi.fn(() => 0),
  isAccessory: vi.fn(() => false),
  getSkuEstPrice: vi.fn(() => 500),
  getSkuFromPrice: vi.fn(() => 1200),
  getUnitPrice: vi.fn(() => 500),
  hasNoPrint: vi.fn(() => false),
  getZoneSurcharge: vi.fn(() => 0),
  TECH_TABS: [],
  SCREEN_FX: [],
  FLEX_FORMATS: [],
  FLEX_MAX_COLORS: 3,
}));

// Mock mockup
vi.mock('./utils/mockup', () => ({
  getGarmentSVG: vi.fn(() => ''),
}));

/**
 * Оболочку выбирает `ShellGate` по `window.location` (а не по роутеру теста):
 * адрес окна ставится тем же путём, что и у роутера
 */
function renderApp(path = '/') {
  window.history.replaceState({}, '', path);
  const router = createMemoryRouter(
    [{ path: '*', Component: App }],
    { initialEntries: [path] }
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  clearFeature('orderStudio');
  useAuthStore.setState({
    user: null,
    // Без сброса статус протекал между кейсами: 'disabled' из одного теста
    // отправлял все следующие на экран «Доступ отключён»
    profileStatus: 'no_profile',
    loading: false,
    initializing: false,
    error: null,
    checkingProfile: false,
    init: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    refreshProfile: vi.fn(),
    isAdmin: () => false,
    isROP: () => false,
    isProduction: () => false,
    isDesigner: () => false,
  });
});

afterEach(() => {
  clearFeature('orderStudio');
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

const live = { approved: true, active: true };
const SELLER = { id: 'u-seller', role: 'manager', email: 's@test.com', is_sales: true, ...live };
const DESIGNER = { id: 'u-designer', role: 'designer', email: 'd@test.com', is_sales: false, ...live };
const ADMIN = { id: 'u-admin', role: 'admin', email: 'a@test.com', is_sales: false, ...live };
const ERP_HOME = 'Обзор производства';
const WAIT = { timeout: 10000 };

describe('App', () => {
  it('shows loading spinner while the session is being checked', () => {
    useAuthStore.setState({ initializing: true });
    renderApp();
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  /**
   * Действие авторизации экран НЕ подменяет.
   *
   * Общий `loading` поднимает каждый вход и каждая регистрация, и пока он стоял
   * гейтом всего приложения, форма на время запроса размонтировалась, а потом
   * монтировалась заново — с пустыми полями. На экране приглашения это съедало
   * исход `already_registered`: сообщение «такой сотрудник уже заведён»
   * приходило в компонент, которого уже не было, и человек видел ту же пустую
   * форму — на проде он нажал «Начать работу» девять раз подряд.
   */
  it('вход не подменяет форму глобальным «Загрузка...»', () => {
    useAuthStore.setState({ loading: true, initializing: false });
    renderApp();

    expect(screen.queryByText('Загрузка...')).toBeNull();
    expect(screen.getByText(/PINHEAD/)).toBeInTheDocument();
  });

  it('shows auth screen when no user', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText(/PINHEAD/)).toBeInTheDocument());
    expect(screen.getByText('Войти')).toBeInTheDocument();
  });

  it('shows pending screen for unapproved user', async () => {
    useAuthStore.setState({
      user: { id: '1', role: 'manager', email: 'test@test.com', approved: false },
      profileStatus: 'pending_approval',
    });
    renderApp();
    await waitFor(() => expect(screen.getByText(/Ожидание подтверждения/)).toBeInTheDocument());
  });

  /**
   * Админ одобряет доступ в своей вкладке, а эта об этом не узнаёт: подписки
   * на собственный профиль нет. Без кнопки человек стоял на стене уже одобренным
   * и должен был сам додуматься до F5.
   */
  it('стена ожидания даёт перечитать профиль без перезагрузки страницы', async () => {
    const refreshProfile = vi.fn();
    useAuthStore.setState({
      user: { id: '1', role: 'manager', email: 'test@test.com', approved: false },
      profileStatus: 'pending_approval',
      refreshProfile,
    });
    renderApp();
    await waitFor(() => expect(screen.getByText(/Ожидание подтверждения/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));

    expect(refreshProfile).toHaveBeenCalled();
  });

  /**
   * Soft-delete (`active=false`) — документированный способ увольнения. Раньше App
   * смотрел только на `approved`, и отключённому рендерилась полная оболочка:
   * человек продолжал работать, а отключение выглядело выполненным.
   */
  it('отключённый аккаунт упирается в стену, а не в рабочий интерфейс', async () => {
    useAuthStore.setState({
      user: { id: '1', role: 'admin', email: 'fired@test.com', approved: true, active: false },
      profileStatus: 'disabled',
    });
    renderApp();
    await waitFor(() => expect(screen.getByText(/Доступ отключён/)).toBeInTheDocument());
    // и это именно стена: рабочей оболочки нет
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });

  it('shows ERP dashboard by default for authenticated user', async () => {
    useAuthStore.setState({
      user: { id: '1', role: 'manager', email: 'test@test.com', approved: true },
      logout: vi.fn(),
    });
    renderApp();
    // integration-рендер ERP (lazy ErpApp + загрузка стора) — под полной парал.
    // нагрузкой дефолтного 1000ms waitFor мало. 4000 тоже иногда не хватало:
    // тест ждёт разрешения ленивого чанка, а не логики, и на загруженной машине
    // это единицы секунд. Запас щедрый намеренно — иначе тест краснеет от соседей.
    await waitFor(
      () => expect(screen.getByText('Обзор производства')).toBeInTheDocument(),
      { timeout: 10000 },
    );
    // ERP nav present (пункт /board в сайдбаре)
    expect(screen.getByText('Производство')).toBeInTheDocument();
  });

  it('при флаге orderStudio admin попадает в список заказов', async () => {
    setFeature('orderStudio', true);
    useAuthStore.setState({
      user: { id: '1', role: 'admin', email: 'test@test.com', approved: true, active: true, is_sales: false },
      logout: vi.fn(),
    });
    renderApp();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Все заказы' })).toBeInTheDocument(), { timeout: 10000 });
  });

  it('менеджер без признака продавца при флаге orderStudio уходит в «Производство»', async () => {
    setFeature('orderStudio', true);
    vi.mocked(switchToProduction).mockClear();
    useAuthStore.setState({
      user: { id: '1', role: 'manager', email: 'test@test.com', approved: true, active: true, is_sales: false },
      logout: vi.fn(),
    });
    renderApp();
    await waitFor(() => expect(switchToProduction).toHaveBeenCalledTimes(1), { timeout: 10000 });
    expect(screen.queryByRole('navigation', { name: 'Разделы заказа' })).toBeNull();
  });

  it('redirects unknown routes to the order list (orderStudio flag on)', async () => {
    setFeature('orderStudio', true);
    useAuthStore.setState({
      user: { id: '1', role: 'admin', email: 'test@test.com', approved: true, active: true, is_sales: false },
      logout: vi.fn(),
    });
    renderApp('/unknown-route');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Все заказы' })).toBeInTheDocument(), { timeout: 10000 });
  });

  it('без флагов admin остаётся в «Производстве» (умолчание профиля)', async () => {
    useAuthStore.setState({ user: ADMIN });
    renderApp();
    await waitFor(() => expect(screen.getByText(ERP_HOME)).toBeInTheDocument(), WAIT);
  });
});

/**
 * Выбор оболочки по профилю, один раз за загрузку на `user.id` (веха 8, К1).
 */
describe('App — ShellGate', () => {
  it('смена checkingProfile и повторный set user с тем же id оболочку не меняют', async () => {
    useAuthStore.setState({ user: ADMIN });
    renderApp('/sales');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Все заказы' })).toBeInTheDocument(), WAIT);

    // admin ушёл на /admin раздела; правило пути там уже не срабатывает
    window.history.replaceState({}, '', '/admin');
    act(() => useAuthStore.setState({ checkingProfile: true }));
    act(() => useAuthStore.setState({ checkingProfile: false, user: { ...ADMIN } }));

    expect(screen.getByRole('navigation', { name: 'Разделы заказа' })).toBeInTheDocument();
    expect(screen.queryByText(ERP_HOME)).toBeNull();
  });

  it('продавец входит в раздел; выход и вход дизайнером в той же вкладке — «Производство»', async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
    vi.mocked(switchToProduction).mockClear();
    useAuthStore.setState({ user: SELLER, logout: realLogout });
    renderApp();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Мои заказы' })).toBeInTheDocument(), WAIT);
    setFeature('orderStudio', true);

    await act(() => useAuthStore.getState().logout());
    expect(localStorage.getItem('pinhead_feature_orderStudio')).toBeNull();
    await waitFor(() => expect(screen.getByText('Войти')).toBeInTheDocument());

    act(() => useAuthStore.setState({ user: DESIGNER }));
    await waitFor(() => expect(screen.getByText(ERP_HOME)).toBeInTheDocument(), WAIT);
    expect(switchToProduction).not.toHaveBeenCalled();
  });

  it('дизайнер на /sales?studio=1 уходит в «Производство» ровно один раз', async () => {
    vi.mocked(switchToProduction).mockClear();
    useAuthStore.setState({ user: DESIGNER });
    renderApp('/sales?studio=1');
    await waitFor(() => expect(switchToProduction).toHaveBeenCalledTimes(1), WAIT);

    act(() => useAuthStore.setState({ checkingProfile: true }));
    act(() => useAuthStore.setState({ checkingProfile: false, user: { ...DESIGNER } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(switchToProduction).toHaveBeenCalledTimes(1);
  });

  it('продавец: «в Производство» хранилище не трогает; / и /sales/x — снова раздел', async () => {
    vi.mocked(switchToProduction).mockClear();
    useAuthStore.setState({ user: SELLER });
    const first = renderApp('/');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Мои заказы' })).toBeInTheDocument(), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Перейти в раздел Производство' }));
    expect(switchToProduction).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('pinhead_feature_orderStudio')).toBeNull();
    first.unmount();

    const again = renderApp('/');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Мои заказы' })).toBeInTheDocument(), WAIT);
    again.unmount();

    renderApp('/sales/x');
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Разделы заказа' })).toBeInTheDocument(), WAIT);
  });

  it.each(['0', 'false'])('выключатель «%s»: продавец на /sales/x?studio=1 — «Производство» без петли', async (off) => {
    vi.stubEnv('VITE_FEATURE_ORDER_STUDIO', off);
    vi.mocked(switchToProduction).mockClear();
    setFeature('orderStudio', true);
    useAuthStore.setState({ user: SELLER });
    renderApp('/sales/x?studio=1');
    await waitFor(() => expect(screen.getByText(ERP_HOME)).toBeInTheDocument(), WAIT);
    expect(screen.queryByRole('navigation', { name: 'Разделы заказа' })).toBeNull();
    expect(switchToProduction).not.toHaveBeenCalled();
  });
});
