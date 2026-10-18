// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож часового пояса тестов (веха 6+7, задача 0; решение 40).
 * vitest — `process.env.TZ` в `setupTests.js`, Playwright — `use.timezoneId`.
 * Граничный случай — пятница 23:30 UTC: в Москве это уже суббота 02:30.
 */
describe('часовой пояс тестов', () => {
  it('vitest считает даты по Москве', () => {
    expect(process.env.TZ).toBe('Europe/Moscow');
    const fridayLateUtc = new Date(Date.UTC(2026, 9, 16, 23, 30));
    expect(fridayLateUtc.getDay()).toBe(6);
    expect(fridayLateUtc.getDate()).toBe(17);
    expect(fridayLateUtc.getHours()).toBe(2);
  });

  it('Playwright открывает браузер в поясе Europe/Moscow', () => {
    const config = readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
    expect(config).toMatch(/^\s{4}timezoneId: 'Europe\/Moscow',$/m);
  });
});
