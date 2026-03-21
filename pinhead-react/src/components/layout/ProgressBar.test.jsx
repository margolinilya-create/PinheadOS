import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProgressBar from './ProgressBar';
import { useStore } from '../../store/useStore';

beforeEach(() => {
  useStore.setState({ step: 0, maxStep: 0 });
});

describe('ProgressBar', () => {
  it('renders 6 step tabs', () => {
    render(<ProgressBar />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
  });

  it('shows step labels', () => {
    render(<ProgressBar />);
    expect(screen.getByText('Изделие')).toBeInTheDocument();
    expect(screen.getByText('Итог')).toBeInTheDocument();
  });

  it('marks current step as active', () => {
    useStore.setState({ step: 2, maxStep: 2 });
    render(<ProgressBar />);
    const buttons = screen.getAllByRole('button');
    // The active step (index 2) should have the active class (CSS module hashed)
    expect(buttons[2].className).toMatch(/active/);
    expect(buttons[2].textContent).toContain('Дизайн');
  });

  it('marks previous steps as done with checkmark', () => {
    useStore.setState({ step: 2, maxStep: 2 });
    render(<ProgressBar />);
    const buttons = screen.getAllByRole('button');
    // steps 0 and 1 should have checkmarks
    expect(buttons[0].textContent).toContain('✓');
    expect(buttons[1].textContent).toContain('✓');
  });

  it('disables steps beyond maxStep', () => {
    useStore.setState({ step: 0, maxStep: 1 });
    render(<ProgressBar />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[2]).toBeDisabled();
    expect(buttons[3]).toBeDisabled();
  });

  it('enables steps up to maxStep', () => {
    useStore.setState({ step: 0, maxStep: 3 });
    render(<ProgressBar />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).not.toBeDisabled();
    expect(buttons[3]).not.toBeDisabled();
  });

  it('calls goToStep when clicking enabled tab', () => {
    const goToStep = vi.fn();
    useStore.setState({ step: 0, maxStep: 2, goToStep });
    render(<ProgressBar />);
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(goToStep).toHaveBeenCalledWith(1);
  });
});
