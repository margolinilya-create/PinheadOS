import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPanel from './AdminPanel';
import { useOrdersStore } from '../../store/useOrdersStore';

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

// Mock useAuthStore
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'dev', role: 'admin' } })),
  },
}));

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AdminPanel />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useOrdersStore.setState({
    orders: [
      { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Alice' }, item_type: 'tee', total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
    ],
    loading: false,
    fetchOrders: vi.fn(),
    updateStatus: vi.fn(),
    deleteOrder: vi.fn(),
  });
});

describe('AdminPanel — вкладка «Заказы ТЗ»', () => {
  it('показывает заказы', () => {
    renderAdmin();
    expect(screen.getByText('PH-0001')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('показывает счётчик заказов', () => {
    renderAdmin();
    expect(screen.getByText(/1 заказ/)).toBeInTheDocument();
  });

  it('показывает поиск, фильтр и обновление', () => {
    renderAdmin();
    expect(screen.getByPlaceholderText(/Поиск/)).toBeInTheDocument();
    expect(screen.getByText('Все статусы')).toBeInTheDocument();
    expect(screen.getByText('Обновить')).toBeInTheDocument();
  });

  it('пустой список без фильтров объясняет, чего ждать', () => {
    useOrdersStore.setState({ orders: [] });
    renderAdmin();
    expect(screen.getByText('Заказов ТЗ пока нет')).toBeInTheDocument();
  });
});

/**
 * Сторож удаления второй реализации управления учётками.
 *
 * Вкладка «Пользователи» правила `profiles.role` напрямую — мимо `erp_employees`,
 * приглашений, матрицы прав и серверной функции `admin-users`. Она была
 * достижима только при `ordersOnly === false`, а таких вызовов в проекте нет,
 * то есть мёртвый код повторял правила, которые живут в `EmployeesScreen`.
 * Вернуть её сюда — значит завести второй источник правды по правам, а на
 * расхождении двух реализаций проект уже ловился (`isPrivileged` против
 * `is_admin()`).
 */
describe('управление учётками сюда не возвращается', () => {
  /**
   * Комментарии снимаются перед проверкой ОТСУТСТВИЯ — правило проекта
   * (то же делает `utils/date.test.ts`). Объяснение «почему этой половины
   * больше нет» называет ровно те же имена, и без стрипа сторож ловил бы
   * объяснение вместо кода.
   */
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

  const read = (p) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));
  const SRC = read('src/components/auth/AdminPanel.jsx');

  it('панель не правит profiles', () => {
    expect(SRC).not.toMatch(/from\(['"]profiles['"]\)/);
  });

  it('панель не знает про роли и одобрение', () => {
    for (const forbidden of ['approved', 'ALL_ROLES', 'ROLE_LABELS']) {
      expect(SRC, `вернулось: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('пропа ordersOnly больше нет — панель всегда только заказы', () => {
    expect(SRC).not.toContain('ordersOnly');
    expect(read('src/erp/screens/AdminScreen.jsx')).not.toContain('ordersOnly');
  });
});
