import { describe, it, expect, afterEach, vi } from 'vitest';
import { browserShowsDayFirst, shouldShowDateEcho } from './dateLocale';

/**
 * Порядок частей даты подменяется целиком: настоящая локаль тестового
 * окружения не важна, важно поведение ОБЕИХ раскладок — ради второй (en-US)
 * эхо под полем когда-то и завели.
 */
function mockParts(parts: { type: string; value: string }[] | Error) {
  // Присваиванием, а не `vi.spyOn`: модуль зовёт `new Intl.DateTimeFormat(...)`,
  // и подменять нужно сам конструктор, а не метод экземпляра
  (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function fake() {
    if (parts instanceof Error) throw parts;
    return { formatToParts: () => parts };
  } as unknown as typeof Intl.DateTimeFormat;
}

const REAL_DTF = Intl.DateTimeFormat;

afterEach(() => {
  (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = REAL_DTF;
  vi.restoreAllMocks();
});

const RU = [
  { type: 'day', value: '07' }, { type: 'literal', value: '.' },
  { type: 'month', value: '10' }, { type: 'literal', value: '.' },
  { type: 'year', value: '2026' },
];
const US = [
  { type: 'month', value: '10' }, { type: 'literal', value: '/' },
  { type: 'day', value: '07' }, { type: 'literal', value: '/' },
  { type: 'year', value: '2026' },
];

describe('browserShowsDayFirst', () => {
  it('ru-RU: день первым — поле читается однозначно', () => {
    mockParts(RU);
    expect(browserShowsDayFirst()).toBe(true);
  });

  it('en-US: месяц первым — «10/07» двусмысленно', () => {
    mockParts(US);
    expect(browserShowsDayFirst()).toBe(false);
  });

  /**
   * Fail-safe в сторону ЭХА: лишняя строка под полем — шум, перепутанный
   * месяц — перенесённый срок заказа. Поэтому всё непонятное считается
   * неоднозначным форматом.
   */
  it('Intl недоступен — считаем формат неоднозначным', () => {
    mockParts(new Error('нет Intl'));
    expect(browserShowsDayFirst()).toBe(false);
  });

  it('формат без дня или месяца — тоже неоднозначный', () => {
    mockParts([{ type: 'year', value: '2026' }]);
    expect(browserShowsDayFirst()).toBe(false);
  });
});

describe('shouldShowDateEcho', () => {
  it('auto: при дневном-первым порядке эхо не нужно — это и есть дублирование', () => {
    mockParts(RU);
    expect(shouldShowDateEcho('auto')).toBe(false);
    expect(shouldShowDateEcho()).toBe(false);
  });

  it('auto: при месяце-первым эхо остаётся — ради него оно и заведено', () => {
    mockParts(US);
    expect(shouldShowDateEcho('auto')).toBe(true);
  });

  it('явные режимы сильнее формата браузера', () => {
    mockParts(RU);
    expect(shouldShowDateEcho('always')).toBe(true);
    mockParts(US);
    expect(shouldShowDateEcho('never')).toBe(false);
  });
});
