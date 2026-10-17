import { describe, it, expect } from 'vitest';
import { isEditable } from './editable';
import type { SalesOrderStatus } from './types';

describe('isEditable — правка открыта только черновику', () => {
  it('draft — можно править', () => {
    expect(isEditable({ status: 'draft' })).toBe(true);
  });

  it.each<SalesOrderStatus>([
    'price_review', 'quoted', 'ready_to_launch', 'production', 'done', 'cancel_requested', 'archived',
  ])('%s — только чтение', (status) => {
    expect(isEditable({ status })).toBe(false);
  });

  it('нет заказа — только чтение', () => {
    expect(isEditable(null)).toBe(false);
    expect(isEditable(undefined)).toBe(false);
  });
});
