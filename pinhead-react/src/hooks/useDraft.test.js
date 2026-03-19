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
    localStorage.setItem('ph_draft_v2', JSON.stringify(data));
    expect(loadDraft()).toEqual(data);
  });

  it('returns null on invalid JSON', () => {
    localStorage.setItem('ph_draft_v2', 'not-json');
    expect(loadDraft()).toBeNull();
  });
});

describe('clearDraft', () => {
  it('removes draft from localStorage', () => {
    localStorage.setItem('ph_draft_v2', '{"step":1}');
    clearDraft();
    expect(localStorage.getItem('ph_draft_v2')).toBeNull();
  });
});
