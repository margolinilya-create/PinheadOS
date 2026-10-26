import { describe, it, expect } from 'vitest';
import { issuesToAsk, mismatchOf } from './maketTools';
import { flat } from '../../fixtures.testutil';
import { MSG_MODEL_MISMATCH } from '../../export/preflight';

const TEE = flat({ categories: ['tshirts'] });
const sku = (code: string, category: string) => ({ code, category }) as never;

describe('maketTools — силуэт не от модели перед PDF макета (B1, веха 5в)', () => {
  it('mismatchOf: худи на флэте футболки — да; футболка — нет; модели нет в каталоге — не судим', () => {
    expect(mismatchOf({ sku_code: 'H-1' }, TEE, [sku('H-1', 'hoodies')])).toBe(true);
    expect(mismatchOf({ sku_code: 'T-1' }, TEE, [sku('T-1', 'tshirts')])).toBe(false);
    expect(mismatchOf({ sku_code: 'X' }, TEE, [])).toBe(false);
  });

  it('issuesToAsk спрашивает о чужом силуэте первым, даже без листов', () => {
    const issues = issuesToAsk([], TEE, null, true);
    expect(issues[0]).toEqual({ level: 'serious', message: MSG_MODEL_MISMATCH });
  });
});
