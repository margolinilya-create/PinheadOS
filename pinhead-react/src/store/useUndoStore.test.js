import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUndoStore, AUTO_DISMISS_MS } from './useUndoStore';

beforeEach(() => {
  useUndoStore.setState({ entries: [] });
});

describe('useUndoStore', () => {
  it('push adds an entry', () => {
    useUndoStore.getState().push({ label: 'gone', restore: () => {} });
    expect(useUndoStore.getState().entries).toHaveLength(1);
    expect(useUndoStore.getState().entries[0].label).toBe('gone');
  });

  it('auto-dismisses entries after AUTO_DISMISS_MS', () => {
    vi.useFakeTimers();
    try {
      useUndoStore.getState().push({ label: 'fade', restore: () => {} });
      expect(useUndoStore.getState().entries).toHaveLength(1);
      vi.advanceTimersByTime(AUTO_DISMISS_MS + 10);
      expect(useUndoStore.getState().entries).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('trigger calls restore and removes the entry', async () => {
    const restore = vi.fn();
    useUndoStore.getState().push({ label: 'x', restore });
    const id = useUndoStore.getState().entries[0].id;
    await useUndoStore.getState().trigger(id);
    expect(restore).toHaveBeenCalledOnce();
    expect(useUndoStore.getState().entries).toHaveLength(0);
  });

  it('trigger is a no-op for unknown id', async () => {
    await useUndoStore.getState().trigger(999);
    expect(useUndoStore.getState().entries).toHaveLength(0);
  });

  it('dismiss removes without calling restore', () => {
    const restore = vi.fn();
    useUndoStore.getState().push({ label: 'manual', restore });
    const id = useUndoStore.getState().entries[0].id;
    useUndoStore.getState().dismiss(id);
    expect(restore).not.toHaveBeenCalled();
    expect(useUndoStore.getState().entries).toHaveLength(0);
  });
});
