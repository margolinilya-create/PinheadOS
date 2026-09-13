import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';
import { UPDATE_TITLE } from '../../lib/appUpdate';

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

/**
 * УСТАРЕВШАЯ ВКЛАДКА РАСПОЗНАЁТСЯ И ПОД ЧУЖИМ ФОЛБЭКОМ.
 *
 * Дефект прода 13.09: `isUpdate` вычислялся, но ветка пользовательского
 * фолбэка стояла раньше и возвращала управление владельцу. Фолбэк передаёт
 * ВЕСЬ раздел «Производство», то есть ровно тот, которым пользуются, —
 * и после выкатки планшет в цеху показывал «Не удалось загрузить экран
 * (Importing a module script failed.) / Проверьте связь» с кнопкой
 * «Повторить», которая перемонтирует тот же исчезнувший чанк и не может
 * сработать никогда.
 *
 * Формулировку берём Safari/WebKit: скриншот из прода пришёл с iPhone,
 * а у каждого движка она своя.
 */
describe('ErrorBoundary: выкатка под пользовательским фолбэком', () => {
  function ThrowChunkError() {
    throw new Error('Importing a module script failed.');
  }

  it('устаревшая вкладка не отдаётся фолбэку владельца', () => {
    render(
      <ErrorBoundary fallback={<div>Проверьте связь и попробуйте ещё раз.</div>}>
        <ThrowChunkError />
      </ErrorBoundary>
    );
    expect(screen.getByText(UPDATE_TITLE)).toBeInTheDocument();
    // Совет про связь неверен: файла нет, сеть ни при чём
    expect(screen.queryByText('Проверьте связь и попробуйте ещё раз.')).toBeNull();
    // И действие обязано быть тем, которое СРАБОТАЕТ
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
  });

  it('настоящая поломка экрана фолбэку владельца по-прежнему отдаётся', () => {
    render(
      <ErrorBoundary fallback={<div>Экран не отрисовался</div>}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Экран не отрисовался')).toBeInTheDocument();
    expect(screen.queryByText(UPDATE_TITLE)).toBeNull();
  });
});
