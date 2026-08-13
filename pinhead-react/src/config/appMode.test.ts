import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isErpOnlyPath,
  resolveAppMode,
  rememberMode,
  modeSwitchUrl,
  switchAppMode,
  isModeSwitchInFlight,
  resetModeSwitchForTests,
} from './appMode';
import { clearFeature, isFeatureEnabled, setFeature } from './features';

/**
 * Сторож блокера QA 13.08.2026: «вход в Order Studio блокирует ERP во всех
 * вкладках». Проверяется не «кнопка есть», а три свойства, каждое из которых
 * по отдельности этот блокер и создавало.
 */

const LS_KEY = 'pinhead_feature_orderStudio';

function withPath(pathname: string) {
  return pathname;
}

beforeEach(() => {
  clearFeature('orderStudio');
  resetModeSwitchForTests();
});

afterEach(() => {
  clearFeature('orderStudio');
  resetModeSwitchForTests();
  vi.unstubAllGlobals();
});

describe('appMode — аварийный выход из Studio', () => {
  it('маршруты ERP открывают ERP даже при включённом флаге Studio', () => {
    setFeature('orderStudio', true);
    for (const path of [
      '/board', '/queue', '/queue/cut', '/task/abc', '/plan',
      '/load', '/purchasing', '/warehouse', '/subcontracting', '/experimental',
    ]) {
      expect(resolveAppMode(withPath(path)), path).toBe('erp');
    }
  });

  it('общие адреса режим не переопределяют — там решает флаг', () => {
    // `/`, `/orders`, `/admin` есть в обоих разделах: по ним режим не определить,
    // и попытка «угадать» сломала бы вход в Studio.
    setFeature('orderStudio', true);
    expect(resolveAppMode('/')).toBe('studio');
    expect(resolveAppMode('/orders')).toBe('studio');
    expect(resolveAppMode('/admin')).toBe('studio');
  });

  it('без флага всё открывается в ERP', () => {
    expect(resolveAppMode('/')).toBe('erp');
    expect(resolveAppMode('/board')).toBe('erp');
  });

  it('isErpOnlyPath не путает префикс с началом другого слова', () => {
    // `/planning` — не `/plan`; иначе аварийный выход перехватывал бы чужие адреса
    expect(isErpOnlyPath('/plan')).toBe(true);
    expect(isErpOnlyPath('/plan/week')).toBe(true);
    expect(isErpOnlyPath('/planning')).toBe(false);
    expect(isErpOnlyPath('/')).toBe(false);
  });
});

describe('appMode — память следует за адресом', () => {
  it('аварийный выход чинит запомненный флаг', () => {
    // Иначе `/board` открылся бы в ERP, а первый переход в «Заказы» вернул
    // бы Studio — человек остался бы в той же ловушке, только на шаг дальше.
    setFeature('orderStudio', true);
    rememberMode(resolveAppMode('/board'));
    expect(localStorage.getItem(LS_KEY)).toBe('0');
    expect(resolveAppMode('/orders')).toBe('erp');
  });

  it('не трогает хранилище, когда расхождения нет', () => {
    setFeature('orderStudio', true);
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    rememberMode('studio');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('appMode — переключение', () => {
  it('уходит на адрес с ЯВНЫМ параметром, а не на голый «/»', () => {
    // Параметр старше localStorage: переключение обязано срабатывать и при
    // чужом значении в хранилище, и когда запись в него запрещена.
    expect(modeSwitchUrl('erp')).toBe('/?studio=0');
    expect(modeSwitchUrl('studio')).toBe('/?studio=1');
  });

  it('параметр адреса перебивает залипший флаг', () => {
    setFeature('orderStudio', true);
    vi.stubGlobal('location', { ...window.location, search: '?studio=0' });
    expect(isFeatureEnabled('orderStudio')).toBe(false);
  });

  it('переключение поднимает метку для beforeunload-стража', () => {
    // Ради этого флага блокер и существовал: страж «визард не сохранён»
    // не отличал намеренный переход от ухода с сайта и глотал переключение.
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });

    expect(isModeSwitchInFlight()).toBe(false);
    switchAppMode('erp');
    expect(isModeSwitchInFlight()).toBe(true);
    expect(assign).toHaveBeenCalledWith('/?studio=0');
    expect(localStorage.getItem(LS_KEY)).toBe('0');
  });
});
