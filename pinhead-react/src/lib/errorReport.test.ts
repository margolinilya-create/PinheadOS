import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport, reportError, _resetReports, MAX_REPORTS } from './errorReport';

/**
 * Отчёт об ошибке обязан быть безобиднее самой ошибки: он не должен ни падать,
 * ни шуметь в сеть, ни работать, пока приёмник не настроен.
 *
 * Тесты идут без `VITE_ERROR_REPORT_URL` — то есть в состоянии, в котором
 * приложение живёт сегодня. Главная проверка здесь: выключенный модуль
 * действительно ничего не делает.
 */

describe('buildReport', () => {
  it('берёт сообщение и стек из Error', () => {
    const r = buildReport(new Error('всё сломалось'), 'render');
    expect(r.message).toBe('всё сломалось');
    expect(r.stack).toContain('Error');
    expect(r.source).toBe('render');
    expect(r.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('переживает не-Error: строку, null, объект', () => {
    expect(buildReport('строка', 'window').message).toBe('строка');
    expect(buildReport(null, 'window').message).toBe('unknown error');
    expect(buildReport({ a: 1 }, 'promise').message).toBe('[object Object]');
  });

  it('обрезает гигантские сообщение и стек — отчёт не должен весить больше страницы', () => {
    const r = buildReport(new Error('x'.repeat(5000)), 'render', 'y'.repeat(9000));
    expect(r.message.length).toBeLessThanOrEqual(500);
    expect((r.stack ?? '').length).toBeLessThanOrEqual(4000);
  });

  it('добавляет стек компонента к стеку ошибки — по нему и ищут виновника', () => {
    const r = buildReport(new Error('bad'), 'render', '    in QueueRow');
    expect(r.stack).toContain('in QueueRow');
  });
});

describe('reportError без настроенного приёмника', () => {
  beforeEach(() => { _resetReports(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('ничего не отправляет и возвращает false', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(reportError(new Error('boom'), 'render')).toBe(false);
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('не бросает даже на том, что нельзя сериализовать', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => reportError(cyclic, 'window')).not.toThrow();
  });
});

/**
 * Ограничители читаются из исходника: включить приёмник в юните нельзя
 * (`import.meta.env` читается на загрузке модуля), а забыть про них —
 * значит однажды получить сотни запросов из цикла рендера.
 */
describe('ограничители отправки', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/errorReport.ts'), 'utf8');

  it('одинаковые ошибки не шлются повторно', () => {
    expect(src).toMatch(/seen\.has\(key\)/);
    expect(src).toMatch(/seen\.add\(key\)/);
  });

  it('есть потолок отчётов за сессию', () => {
    expect(MAX_REPORTS).toBeGreaterThan(0);
    expect(MAX_REPORTS).toBeLessThanOrEqual(100);
    expect(src).toMatch(/sent >= MAX_REPORTS/);
  });

  it('вся отправка обёрнута в try/catch — отчёт не роняет приложение второй раз', () => {
    const body = src.slice(src.indexOf('export function reportError'));
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/catch\s*\{\s*return false;/);
  });

  it('адрес приёмника берётся из env, а не зашит в код', () => {
    expect(src).toContain('import.meta.env?.VITE_ERROR_REPORT_URL');
    // Ни одного захардкоженного адреса: ключи и эндпоинты — только из .env
    expect(src).not.toMatch(/https?:\/\/(?!\s)[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it('промисы слушает только main.jsx — двойного отчёта нет', () => {
    expect(src).not.toContain("addEventListener('unhandledrejection'");
    const main = readFileSync(join(process.cwd(), 'src/main.jsx'), 'utf8');
    expect(main).toContain("addEventListener('unhandledrejection'");
    expect(main).toContain("reportError(event.reason, 'promise')");
  });
});

describe('ErrorBoundary отдаёт отчёт наружу', () => {
  it('зовёт reportError со стеком компонента', () => {
    const eb = readFileSync(
      join(process.cwd(), 'src/components/shared/ErrorBoundary.jsx'), 'utf8',
    );
    // Консоль оставлена для разработки, но одной её мало: о белом экране
    // в цеху по чужой консоли не узнать (C7 аудита)
    expect(eb).toContain("reportError(error, 'render', info?.componentStack)");
    expect(eb).toContain('console.error');
  });
});
