import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_COLORS, readCanvasColors, useCanvasTheme } from './useCanvasTheme';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('цвета холста из токенов', () => {
  it('токен на контейнере читается; пустой — светлая палитра по умолчанию', () => {
    const el = document.createElement('div');
    el.style.setProperty('--accent', '#123456');
    document.body.appendChild(el);
    const c = readCanvasColors(el);
    expect(c.accent).toBe('#123456');
    expect(c.safe).toBe(DEFAULT_COLORS.safe);
    el.remove();
  });

  it('без контейнера — палитра по умолчанию', () => {
    expect(readCanvasColors(null)).toEqual(DEFAULT_COLORS);
  });

  it('смена темы (html[data-theme]) перечитывает токены', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ref = { current: el };
    const { result } = renderHook(() => useCanvasTheme(ref));
    expect(result.current.colors.accent).toBe(DEFAULT_COLORS.accent);
    expect(result.current.coarse).toBe(false);
    el.style.setProperty('--accent', '#5B5BFF');
    act(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await waitFor(() => expect(result.current.colors.accent).toBe('#5B5BFF'));
    el.remove();
  });
});
