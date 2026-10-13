import { useEffect, useState } from 'react';

/**
 * Общая тема приложения (Order Studio + ERP): light | dark.
 * Ставит html[data-theme] и сохраняет ВЫБОР ЧЕЛОВЕКА в localStorage
 * ('ph_theme') — ключ единый, поэтому тема общая для обоих разделов.
 *
 * ПОЧЕМУ СИСТЕМНАЯ НАСТРОЙКА, А НЕ ВСЕГДА СВЕТЛАЯ. `prefers-color-scheme`
 * не встречался во всём проекте ни разу, хотя `docs/DESIGN.md` обещает
 * «тёмная тема — автоматически»: первый визит был светлым независимо от
 * настройки ОС. На планшете цеха с тёмной системной темой это означало
 * засвеченный экран до тех пор, пока человек не найдёт тумблер сам.
 *
 * ВЫБОР ЧЕЛОВЕКА СИЛЬНЕЕ СИСТЕМЫ и держится вечно. Поэтому запись в
 * localStorage идёт ТОЛЬКО из `toggleTheme`, а не из эффекта: эффект
 * записывал бы вычисленное значение при первой же отрисовке, и системная
 * настройка оказалась бы заморожена навсегда — «авто» превратилось бы
 * в «как было в день первого визита».
 */
const THEME_KEY = 'ph_theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Хранилище может быть недоступно (приватный режим, запрет на сайт) */
function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  // matchMedia нет в jsdom — там остаётся прежняя светлая по умолчанию
  if (typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState(() => storedTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /**
   * Пока человек не выбрал сам, идём за системой: настройку меняют посреди
   * дня (автоматический ночной режим планшета), и застывший светлый экран
   * читался бы как «тема сломалась».
   */
  useEffect(() => {
    if (storedTheme() || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e) => { if (!storedTheme()) setTheme(e.matches ? 'dark' : 'light'); };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = () => setTheme((t) => {
    const next = t === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* хранилище недоступно — тема продержится до перезагрузки */
    }
    return next;
  });

  return { theme, toggleTheme };
}
