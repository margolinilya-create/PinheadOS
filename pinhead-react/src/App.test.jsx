import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './store/useAuthStore';
import { useStore } from './store/useStore';
import { setFeature, clearFeature } from './config/features';

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
    removeChannel: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
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

// Mock useDraft
vi.mock('./hooks/useDraft', () => ({
  useDraft: () => ({ draftStatus: 'idle', resetDraft: vi.fn() }),
}));

// Mock pricing
vi.mock('./utils/pricing', () => ({
  calcTotal: vi.fn(() => 0),
  getTotalQty: vi.fn(() => 0),
  isAccessory: vi.fn(() => false),
  getSkuEstPrice: vi.fn(() => 500),
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

// Mock recharts
vi.mock('recharts', () => ({
  BarChart: ({ children }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Legend: () => null,
  AreaChart: ({ children }) => <div>{children}</div>,
  Area: () => null,
}));

// Mock QRCode
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('') },
}));

function renderApp(path = '/') {
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
});

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

  it('shows main wizard for authenticated admin when orderStudio flag is on', async () => {
    setFeature('orderStudio', true);
    useAuthStore.setState({
      user: { id: '1', role: 'admin', email: 'test@test.com', approved: true },
      logout: vi.fn(),
    });
    useStore.setState({ step: 0 });
    renderApp();
    await waitFor(() => expect(screen.getByText('pinhead')).toBeInTheDocument());
    expect(screen.getByText('ИЗДЕЛИЕ')).toBeInTheDocument();
  });

  it('shows header with navigation for authenticated user when orderStudio flag is on', async () => {
    setFeature('orderStudio', true);
    useAuthStore.setState({
      user: { id: '1', role: 'manager', email: 'test@test.com', approved: true },
      logout: vi.fn(),
    });
    renderApp();
    // «Заказы» (канбан ТЗ) убраны в сессии 33 — проверяем оставшийся пункт
    await waitFor(() => expect(screen.getByText('ТЗ')).toBeInTheDocument());
  });

  it('redirects unknown routes to home (orderStudio flag on)', async () => {
    setFeature('orderStudio', true);
    useAuthStore.setState({
      user: { id: '1', role: 'admin', email: 'test@test.com', approved: true },
      logout: vi.fn(),
    });
    renderApp('/unknown-route');
    // Should redirect and show wizard
    await waitFor(() => expect(screen.getByText('pinhead')).toBeInTheDocument());
  });
});
