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
});
