import { describe, it, expect } from 'vitest';
import { appOriginOf, PROD_ORIGIN } from './appOrigin';

describe('APP_ORIGIN — адрес в подвале ТЗ (К9)', () => {
  it('задан — без хвостового «/»', () => {
    expect(appOriginOf('https://pinhead-os.vercel.app/')).toBe('https://pinhead-os.vercel.app');
    expect(appOriginOf(' https://x.example ')).toBe('https://x.example');
  });
  it('пусто, путь или чужая схема — боевой адрес', () => {
    expect(appOriginOf(undefined)).toBe(PROD_ORIGIN);
    expect(appOriginOf('')).toBe(PROD_ORIGIN);
    expect(appOriginOf('javascript:alert(1)')).toBe(PROD_ORIGIN);
    expect(appOriginOf('https://x.example/path')).toBe(PROD_ORIGIN);
  });
});
