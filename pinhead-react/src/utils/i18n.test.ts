import { describe, expect, it } from 'vitest';
import { isNetworkFailure, networkFailureMessage } from './i18n';

/**
 * «Не нашлось текста» ≠ «нет связи».
 *
 * `isNetworkFailure` сравнивал результат `networkFailureMessage`, а тот отдаёт
 * фразу «нет связи с сервером» ещё и как ФОЛБЭК — для причины без текста.
 * Отклонение обычным объектом (`Promise.reject({ code: 'PGRST301' })`) или
 * `Error('')` объявлялось потерей связи: человек видел «Нет связи с сервером»
 * там, где связь была, а настоящая причина исчезала.
 */
describe('isNetworkFailure отличает сеть от прочего', () => {
  it.each(['Load failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource'])(
    '%s — сетевой сбой',
    (msg) => {
      expect(isNetworkFailure(new Error(msg))).toBe(true);
    },
  );

  it('причина без текста сетевой не считается', () => {
    expect(isNetworkFailure({ code: 'PGRST301' })).toBe(false);
    expect(isNetworkFailure(new Error(''))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });

  it('прикладная ошибка сетевой не считается', () => {
    expect(isNetworkFailure(new Error('new row violates row-level security policy')))
      .toBe(false);
  });
});

describe('networkFailureMessage всегда даёт текст человеку', () => {
  it('сетевой сбой называется прямо', () => {
    expect(networkFailureMessage(new Error('Load failed'))).toBe('нет связи с сервером');
  });

  it('прикладная ошибка сохраняет свой текст', () => {
    expect(networkFailureMessage(new Error('боом'))).toBe('боом');
    expect(networkFailureMessage('строка причины')).toBe('строка причины');
  });

  /** Фолбэк остаётся у сообщения: молчать в тосте нельзя, даже если текста нет */
  it('причина без текста получает фолбэк', () => {
    expect(networkFailureMessage({ code: 'PGRST301' })).toBe('нет связи с сервером');
    expect(networkFailureMessage(null)).toBe('нет связи с сервером');
  });

  it('null не превращается в слово «null»', () => {
    expect(networkFailureMessage(null)).not.toContain('null');
  });
});
