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

  // Локальный фолбэк: падение одного экрана ERP не должно ронять оболочку,
  // а полноэкранный блок по умолчанию разорвал бы layout.
  it('рендерит переданный fallback вместо полноэкранного экрана', () => {
    render(
      <ErrorBoundary fallback={<div>Экран не отрисовался</div>}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Экран не отрисовался')).toBeInTheDocument();
    expect(screen.queryByText('Что-то пошло не так')).toBeNull();
  });

  it('fallback-функция получает ошибку и сброс, сброс возвращает содержимое', () => {
    function Wrapper() {
      return (
        <ErrorBoundary fallback={(error, reset) => (
          <div>
            <span>Упало: {error.message}</span>
            <button type="button" onClick={reset}>Попробовать снова</button>
          </div>
        )}>
          <ThrowingChild shouldThrow={false} />
        </ErrorBoundary>
      );
    }
    const { rerender } = render(
      <ErrorBoundary fallback={(error, reset) => (
        <div>
          <span>Упало: {error.message}</span>
          <button type="button" onClick={reset}>Попробовать снова</button>
        </div>
      )}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Упало: Test crash')).toBeInTheDocument();

    // после сброса граница снова рендерит детей (уже не падающих)
    fireEvent.click(screen.getByText('Попробовать снова'));
    rerender(<Wrapper />);
    expect(screen.getByText('Child content')).toBeInTheDocument();
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
