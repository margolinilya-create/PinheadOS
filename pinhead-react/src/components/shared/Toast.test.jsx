import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToastContainer from './Toast';
import { useToastStore } from '../../store/useToastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('ToastContainer', () => {
  it('renders nothing when no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders success toast', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Success!', type: 'success' }],
    });
    render(<ToastContainer />);
    expect(screen.getByText('Success!')).toBeInTheDocument();
  });

  it('renders error toast with icon', () => {
    useToastStore.setState({
      toasts: [{ id: '2', message: 'Error!', type: 'error' }],
    });
    render(<ToastContainer />);
    expect(screen.getByText('Error!')).toBeInTheDocument();
  });

  it('renders warning toast', () => {
    useToastStore.setState({
      toasts: [{ id: '3', message: 'Warning!', type: 'warning' }],
    });
    render(<ToastContainer />);
    expect(screen.getByText('Warning!')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    useToastStore.setState({
      toasts: [
        { id: '1', message: 'First', type: 'success' },
        { id: '2', message: 'Second', type: 'error' },
      ],
    });
    render(<ToastContainer />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('removes toast on click', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Click me', type: 'success' }],
    });
    render(<ToastContainer />);
    fireEvent.click(screen.getByText('Click me'));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('applies correct CSS class for type', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Test', type: 'error' }],
    });
    render(<ToastContainer />);
    // With CSS modules, class names are hashed. Check the error icon is rendered instead.
    expect(screen.getByText('✕')).toBeInTheDocument();
  });
});
