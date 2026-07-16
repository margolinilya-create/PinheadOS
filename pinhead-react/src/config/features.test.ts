import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isFeatureEnabled, setFeature, clearFeature } from './features';

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

  it('clearFeature сбрасывает к дефолту', () => {
    setFeature('orderStudio', true);
    clearFeature('orderStudio');
    expect(isFeatureEnabled('orderStudio')).toBe(false);
  });
});
