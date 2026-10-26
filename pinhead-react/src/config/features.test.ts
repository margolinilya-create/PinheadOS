import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isFeatureEnabled, setFeature, clearFeature, FEATURE_STORAGE_KEYS, readStoredFeature,
} from './features';

describe('features', () => {
  beforeEach(() => clearFeature('orderStudio'));
  afterEach(() => clearFeature('orderStudio'));

  it('orderStudio выключен по умолчанию', () => {
    expect(isFeatureEnabled('orderStudio')).toBe(false);
  });

  it('включается через setFeature', () => {
    setFeature('orderStudio', true);
    expect(isFeatureEnabled('orderStudio')).toBe(true);
  });

  it('выключается через setFeature', () => {
    setFeature('orderStudio', true);
    setFeature('orderStudio', false);
    expect(isFeatureEnabled('orderStudio')).toBe(false);
  });

  it('ключ флага — pinhead_feature_<имя>, его читает readStoredFeature', () => {
    expect(FEATURE_STORAGE_KEYS).toEqual({
      orderStudio: 'pinhead_feature_orderStudio',
      styleguide: 'pinhead_feature_styleguide',
      designStudio: 'pinhead_feature_designStudio',
    });
    setFeature('orderStudio', false);
    expect(readStoredFeature('orderStudio')).toBe('0');
    clearFeature('orderStudio');
    expect(readStoredFeature('orderStudio')).toBeNull();
  });

  it('clearFeature сбрасывает к дефолту', () => {
    setFeature('orderStudio', true);
    clearFeature('orderStudio');
    expect(isFeatureEnabled('orderStudio')).toBe(false);
  });

  it('designStudio (вкладка «Дизайн» 2.0, веха 5в) включён по умолчанию; выбор устройства его гасит', () => {
    clearFeature('designStudio');
    expect(isFeatureEnabled('designStudio')).toBe(true);
    setFeature('designStudio', false);
    expect(isFeatureEnabled('designStudio')).toBe(false);
    clearFeature('designStudio');
  });

  it('designStudio: ?design2=0 на заход — прежний вид', () => {
    const prev = window.location.href;
    window.history.replaceState(null, '', '/?design2=0');
    expect(isFeatureEnabled('designStudio')).toBe(false);
    window.history.replaceState(null, '', prev);
  });
});
