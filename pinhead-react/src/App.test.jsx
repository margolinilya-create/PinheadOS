import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './store/useAuthStore';
import { useStore } from './orderstudio/store/useStore';
import { setFeature, clearFeature } from './config/features';

// Mock catalogs loader
vi.mock('./orderstudio/lib/catalogs', () => ({
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
vi.mock('./orderstudio/hooks/useDraft', () => ({
  useDraft: () => ({ draftStatus: 'idle', resetDraft: vi.fn() }),
}));

// Mock pricing
vi.mock('./orderstudio/utils/pricing', () => ({
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
vi.mock('./orderstudio/utils/mockup', () => ({
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
    loading: false,
    error: null,
    init: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
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
  it('shows loading spinner when loading', () => {
    useAuthStore.setState({ loading: true });
    renderApp();
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('shows auth screen when no user', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText(/PINHEAD/)).toBeInTheDocument());
    expect(screen.getByText('Войти')).toBeInTheDocument();
  });

  it('shows pending screen for unapproved user', async () => {
    useAuthStore.setState({
      user: { id: '1', role: 'manager', email: 'test@test.com', approved: false },
    });
    renderApp();
    await waitFor(() => expect(screen.getByText(/Ожидание подтверждения/)).toBeInTheDocument());
  });

  it('shows ERP dashboard by default for authenticated user', async () => {
    useAuthStore.setState({
      user: { id: '1', role: 'manager', email: 'test@test.com', approved: true },
      logout: vi.fn(),
    });
    renderApp();
    await waitFor(() => expect(screen.getByText('Обзор производства')).toBeInTheDocument());
    // ERP nav present
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
    await waitFor(() => expect(screen.getByText('Заказы')).toBeInTheDocument());
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
