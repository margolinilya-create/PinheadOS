import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';

/**
 * Тема по системной настройке.
 *
 * `prefers-color-scheme` не встречался во всём проекте НИ РАЗУ, хотя
 * `docs/DESIGN.md` обещает «тёмная тема — автоматически»: первый визит был
 * светлым независимо от настройки ОС. На планшете цеха с тёмной системной
 * темой это засвеченный экран до тех пор, пока человек не найдёт тумблер.
 *
 * Второе, что здесь сторожится, — что выбор человека НЕ ПОДМЕНЯЕТСЯ системой
 * и что системная настройка не замораживается первым же визитом. Прежняя
 * версия писала в localStorage из эффекта, то есть при первой отрисовке:
 * будь там `systemTheme()`, «авто» превратилось бы в «как было в тот день».
 */

const listeners = new Set();

function mockSystem(dark) {
  window.matchMedia = (query) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
  });
}

beforeEach(() => {
  listeners.clear();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  delete window.matchMedia;
  vi.restoreAllMocks();
});

describe('useTheme', () => {
  it('без сохранённого выбора берёт системную тёмную', () => {
    mockSystem(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('без сохранённого выбора и при светлой системе остаётся светлой', () => {
    mockSystem(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('сохранённый выбор человека сильнее системы', () => {
    localStorage.setItem('ph_theme', 'light');
    mockSystem(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('системная настройка НЕ записывается в хранилище', () => {
    /**
     * Иначе «авто» превращается в «как было в день первого визита»: запись
     * из эффекта делала бы вычисленное значение сохранённым выбором.
     */
    mockSystem(true);
    renderHook(() => useTheme());
    expect(localStorage.getItem('ph_theme')).toBeNull();
  });

  it('тумблер сохраняет выбор', () => {
    mockSystem(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('ph_theme')).toBe('dark');
  });

  it('пока человек не выбрал, следует за сменой системной настройки', () => {
    // Настройку меняют посреди дня (ночной режим планшета), и застывший
    // светлый экран читался бы как «тема сломалась»
    mockSystem(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');

    act(() => listeners.forEach((cb) => cb({ matches: true })));
    expect(result.current.theme).toBe('dark');
  });

  it('после выбора человека смена системной настройки его не перебивает', () => {
    mockSystem(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());          // человек выбрал тёмную
    act(() => listeners.forEach((cb) => cb({ matches: false })));
    expect(result.current.theme).toBe('dark');
  });

  it('недоступное хранилище не роняет хук', () => {
    // Приватный режим, запрет site data: доступ бросает у самого accessor'а
    mockSystem(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('light');
  });
});
