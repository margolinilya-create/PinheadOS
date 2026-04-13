import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the hook directly to control flag values per test
const flagState = {
  tech_card_builder: false,
  workshop_board: false,
  foreman_screen: false,
  payroll_screen: false,
  notifications_bell: false,
};
vi.mock('../../../hooks/useFeatureFlag', () => ({
  useFeatureFlag: (flag) => flagState[flag] ?? false,
}));

const { default: V2Nav } = await import('./V2Nav');

beforeEach(() => {
  cleanup();
  flagState.tech_card_builder = false;
  flagState.workshop_board = false;
  flagState.foreman_screen = false;
  flagState.payroll_screen = false;
});

function renderNav() {
  return render(
    <MemoryRouter>
      <V2Nav />
    </MemoryRouter>
  );
}

describe('V2Nav', () => {
  it('renders nothing when every v2 flag is off (prod main behavior)', () => {
    const { container } = renderNav();
    expect(container.firstChild).toBeNull();
  });

  it('renders Tech Cards link when tech_card_builder flag is on', () => {
    flagState.tech_card_builder = true;
    renderNav();
    expect(screen.getByText('Tech Cards')).toBeInTheDocument();
    expect(screen.queryByText('Цех')).not.toBeInTheDocument();
  });

  it('renders all four chips when every flag is on', () => {
    flagState.tech_card_builder = true;
    flagState.workshop_board = true;
    flagState.foreman_screen = true;
    flagState.payroll_screen = true;
    renderNav();
    expect(screen.getByText('Tech Cards')).toBeInTheDocument();
    expect(screen.getByText('Цех')).toBeInTheDocument();
    expect(screen.getByText('Мастер')).toBeInTheDocument();
    expect(screen.getByText('Payroll')).toBeInTheDocument();
  });

  it('Tech Cards chip points at /tech-cards', () => {
    flagState.tech_card_builder = true;
    renderNav();
    const link = screen.getByText('Tech Cards').closest('a');
    expect(link).toHaveAttribute('href', '/tech-cards');
  });
});
