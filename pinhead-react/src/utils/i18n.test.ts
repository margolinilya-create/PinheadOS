import { describe, expect, it } from 'vitest';
import {
  AUTH_LOCK_MESSAGE, isAuthLockFailure, isNetworkFailure, networkFailureMessage,
  translateSupabaseError,
} from './i18n';

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

/**
 * Перехваченный лок сессии — не сеть и не отказ сервера.
 *
 * `supabase-js` держит сессию под общим Web Lock, и с auth-js 2.98 захват,
 * прождавший дольше пяти секунд, забирает лок силой (`steal: true`). Прежний
 * держатель получает `AbortError: Lock broken by another request with the
 * 'steal' option`, и этот английский текст доходил до человека дословно —
 * на форме входа, красной полосой, четырежды подряд.
 */
describe('перехваченный лок сессии называется по-человечески', () => {
  const stolen = () => {
    const e = new Error("Lock broken by another request with the 'steal' option.");
    e.name = 'AbortError';
    return e;
  };

  it('узнаётся и в брошенной ошибке, и в объекте { message }', () => {
    expect(isAuthLockFailure(stolen())).toBe(true);
    expect(isAuthLockFailure({ message: "AbortError: Lock broken by another request with the 'steal' option." }))
      .toBe(true);
  });

  it('сетевым сбоем не считается — иначе повтор и текст выберутся не те', () => {
    expect(isNetworkFailure(stolen())).toBe(false);
  });

  it('отказ сервера локом не считается', () => {
    expect(isAuthLockFailure(new Error('permission denied for table erp_orders'))).toBe(false);
    expect(isAuthLockFailure(null)).toBe(false);
  });

  it('и в броске, и в сообщении получается одна и та же фраза', () => {
    expect(networkFailureMessage(stolen())).toBe(AUTH_LOCK_MESSAGE);
    expect(translateSupabaseError("Lock broken by another request with the 'steal' option."))
      .toBe(AUTH_LOCK_MESSAGE);
  });
});
