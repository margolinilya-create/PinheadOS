import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Suppress console.error from ErrorBoundary during tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function ThrowingChild({ shouldThrow }) {
  if (shouldThrow) throw new Error('Test crash');
  return <div>Child content</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByText('Test crash')).toBeInTheDocument();
  });

  it('shows reload button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Перезагрузить')).toBeInTheDocument();
  });

  it('shows default message when error has no message', () => {
    function ThrowNull() { throw { notAnError: true }; }
    render(
      <ErrorBoundary>
        <ThrowNull />
      </ErrorBoundary>
    );
    expect(screen.getByText('Произошла непредвиденная ошибка')).toBeInTheDocument();
  });

  it('calls window.location.reload on button click', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Перезагрузить'));
    expect(reloadMock).toHaveBeenCalled();
  });
});
