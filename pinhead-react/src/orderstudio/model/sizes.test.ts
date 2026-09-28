import { describe, it, expect } from 'vitest';
import { SALES_SIZE_PRESETS } from './sizes';
import { SIZE_PRESETS } from '../../erp/utils/orderForm';

describe('ряды размеров Order совпадают с формой ERP', () => {
  it('взрослый и детский', () => {
    expect(SALES_SIZE_PRESETS).toEqual(SIZE_PRESETS);
  });
});
