import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_TOKENS, TOKEN_NAMES, readCanvasTokens, useCanvasTokens } from './useCanvasTokens';

/** Подмена `getComputedStyle`: значения токенов задаёт тест */
function stubStyle(values: Record<string, string>) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () => ({ getPropertyValue: (name: string) => values[name] ?? '' }) as unknown as CSSStyleDeclaration,
  );
}

/** `matchMedia` с ручным переключением `change` */
function stubMedia() {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener: (_: string, cb: () => void) => {
      if (!listeners.has(q)) listeners.set(q, new Set());
      listeners.get(q)!.add(cb);
    },
    removeEventListener: (_: string, cb: () => void) => listeners.get(q)?.delete(cb),
  }));
  return { fire: (q: string) => listeners.get(q)?.forEach((cb) => cb()), count: (q: string) => listeners.get(q)?.size ?? 0 };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

describe('useCanvasTokens', () => {
  it('без CSS — значения по умолчанию; пустой токен не затирает', () => {
    expect(readCanvasTokens(null)).toEqual(DEFAULT_TOKENS);
    stubStyle({ [TOKEN_NAMES.zone]: ' #123456 ' });
    expect(readCanvasTokens(document.body)).toEqual({ ...DEFAULT_TOKENS, zone: '#123456' });
  });

  it('перечитывает цвета при смене data-theme', async () => {
    stubMedia();
    stubStyle({ [TOKEN_NAMES.paper]: '#fefefe' });
    const ref = { current: document.body };
    const { result } = renderHook(() => useCanvasTokens(ref));
    expect(result.current.tokens.paper).toBe('#fefefe');

    stubStyle({ [TOKEN_NAMES.paper]: '#eeeeee' });
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await Promise.resolve();
    });
    expect(result.current.tokens.paper).toBe('#eeeeee');
  });

  it('перечитывает цвета при смене системной темы (prefers-color-scheme) и отписывается', () => {
    const media = stubMedia();
    stubStyle({ [TOKEN_NAMES.safe]: '#111111' });
    const ref = { current: document.body };
    const { result, unmount } = renderHook(() => useCanvasTokens(ref));
    stubStyle({ [TOKEN_NAMES.safe]: '#222222' });
    act(() => media.fire('(prefers-color-scheme: dark)'));
    expect(result.current.tokens.safe).toBe('#222222');
    unmount();
    expect(media.count('(prefers-color-scheme: dark)')).toBe(0);
  });

  it('палец (pointer: coarse) — флаг coarse', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(pointer: coarse)', media: q, addEventListener: () => {}, removeEventListener: () => {},
    }));
    const { result } = renderHook(() => useCanvasTokens({ current: null }));
    expect(result.current.coarse).toBe(true);
  });
});
