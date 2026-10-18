/**
 * Адрес приложения для подвала ТЗ (К9): `VITE_APP_ORIGIN`, а не `location.origin` —
 * ТЗ, собранное на превью-деплое или на localhost, не напечатает чужой адрес.
 * Не задан — боевой адрес. В хэш содержимого ссылка подвала не входит (К1).
 */
export const PROD_ORIGIN = 'https://pinhead-os.vercel.app';

/** Адрес без хвостового «/»; пусто или не https?: — боевой */
export function appOriginOf(raw: string | undefined | null): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/.test(v) ? v : PROD_ORIGIN;
}

export const APP_ORIGIN = appOriginOf(import.meta.env.VITE_APP_ORIGIN as string | undefined);
