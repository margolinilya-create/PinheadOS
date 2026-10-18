// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeBuildId } from '../../scripts/build-id.mjs';

/**
 * Маркер сборки и аварийный выключатель (веха 8, К1): redeploy того же коммита
 * с `VITE_FEATURE_ORDER_STUDIO=0` обязан дать ДРУГОЙ маркер, иначе открытая
 * вкладка не узнает о выключении (`isNewerBuild` сравнивает маркеры).
 */
describe('makeBuildId', () => {
  const SHA = '0123456789abcdef0123';

  it('коммит — 12 знаков, плюс значение флага', () => {
    expect(makeBuildId({ VERCEL_GIT_COMMIT_SHA: SHA, VITE_FEATURE_ORDER_STUDIO: '0' })).toBe('0123456789ab-0');
  });

  it('другое значение флага — другой маркер при том же коммите', () => {
    const ids = ['0', 'false', '1', undefined].map((flag) => makeBuildId({ VERCEL_GIT_COMMIT_SHA: SHA, VITE_FEATURE_ORDER_STUDIO: flag }));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('без коммита — момент сборки', () => {
    expect(makeBuildId({}, () => 'T')).toBe('T-');
  });
});
