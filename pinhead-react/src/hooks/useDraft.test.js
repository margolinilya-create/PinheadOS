import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadDraft, clearDraft } from './useDraft';

// Mock useStore
vi.mock('../store/useStore', () => ({
  useStore: Object.assign(vi.fn(() => ({})), {
    setState: vi.fn(),
    getState: vi.fn(() => ({ resetOrder: vi.fn() })),
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

beforeEach(() => {
  localStorage.clear();
});

describe('loadDraft', () => {
  it('returns null when no draft saved', () => {
    expect(loadDraft()).toBeNull();
  });

  it('returns parsed draft data', () => {
    const data = { step: 2, type: 'tee' };
    localStorage.setItem('pinhead_draft', JSON.stringify(data));
    expect(loadDraft()).toEqual(data);
  });

  it('returns null on invalid JSON', () => {
    localStorage.setItem('pinhead_draft', 'not-json');
    expect(loadDraft()).toBeNull();
  });
});

describe('clearDraft', () => {
  it('removes draft from localStorage', () => {
    localStorage.setItem('pinhead_draft', '{"step":1}');
    clearDraft();
    expect(localStorage.getItem('pinhead_draft')).toBeNull();
  });
});
