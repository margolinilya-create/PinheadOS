import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TechCard from './TechCard';
import { useOrdersStore } from '../../store/useOrdersStore';
import { useAuthStore } from '../../store/useAuthStore';

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

// Mock mockup
vi.mock('../../utils/mockup', () => ({
  getGarmentSVG: vi.fn(() => '<svg>mockup</svg>'),
}));

// Mock QRCode
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mock') },
}));

const mockOrder = {
  id: 1,
  order_number: 'PH-0001',
  status: 'production',
  total_qty: 50,
  total_sum: 25000,
  item_type: 'tee',
  created_at: new Date().toISOString(),
  data: {
    name: 'Test Client',
    type: 'tee',
    fabric: 'cotton',
    color: '#fff',
    fit: 'regular',
    sizes: { M: 30, L: 20 },
    zones: ['front'],
    zoneTechs: { front: 'screen' },
    deadline: '2025-12-31',
    notes: 'Priority order',
    sku: { name: 'T-Shirt', category: 'tshirts' },
  },
};

beforeEach(() => {
  useOrdersStore.setState({
    patchOrderData: vi.fn(),
  });
  useAuthStore.setState({
    user: { id: '1', name: 'Admin', role: 'admin' },
  });
});

describe('TechCard', () => {
  it('renders order number', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('[PH-0001]')).toBeInTheDocument();
  });

  it('renders product info', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('T-Shirt')).toBeInTheDocument();
  });

  it('renders client name', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('Test Client')).toBeInTheDocument();
  });

  it('renders notes', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('Priority order')).toBeInTheDocument();
  });

  it('shows print button', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('ПЕЧАТЬ / PDF')).toBeInTheDocument();
  });

  it('shows close button', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('ЗАКРЫТЬ')).toBeInTheDocument();
  });

  it('calls onClose when clicking close', () => {
    const onClose = vi.fn();
    render(<TechCard order={mockOrder} onClose={onClose} onStatusChange={vi.fn()} />);
    fireEvent.click(screen.getByText('ЗАКРЫТЬ'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders checklist section', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('ЧЕК-ЛИСТ ОПЕРАЦИЙ')).toBeInTheDocument();
    expect(screen.getByText('Раскрой')).toBeInTheDocument();
    expect(screen.getByText('Пошив')).toBeInTheDocument();
  });

  it('renders comments section', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('КОММЕНТАРИИ')).toBeInTheDocument();
    expect(screen.getByText('Нет комментариев')).toBeInTheDocument();
  });

  it('renders photo section', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByText('ФОТО РЕЗУЛЬТАТА')).toBeInTheDocument();
  });

  it('shows grand total', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getAllByText(/ИТОГО/).length).toBeGreaterThan(0);
  });

  it('renders status select', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    const select = document.querySelector('.tc-status-select');
    expect(select).toBeTruthy();
    expect(select.value).toBe('production');
  });

  it('adds comment when typing and clicking send', () => {
    render(<TechCard order={mockOrder} onClose={vi.fn()} onStatusChange={vi.fn()} />);
    const input = screen.getByPlaceholderText('Комментарий...');
    fireEvent.change(input, { target: { value: 'New comment' } });
    fireEvent.click(screen.getByText('Отправить'));
    expect(screen.getByText('New comment')).toBeInTheDocument();
  });
});
