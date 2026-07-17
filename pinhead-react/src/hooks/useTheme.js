import { useEffect, useState } from 'react';

/**
 * Общая тема приложения (Order Studio + ERP): light | dark.
 * Ставит html[data-theme] и сохраняет выбор в localStorage ('ph_theme') —
 * ключ единый, поэтому тема общая для обоих разделов.
 */
const THEME_KEY = 'ph_theme';

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return { theme, toggleTheme };
}
