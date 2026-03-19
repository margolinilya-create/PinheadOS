import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore, toast } from './useToastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useToastStore', () => {
  it('starts with empty toasts', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('add() creates a toast with id, message, and type', () => {
    useToastStore.getState().add('Hello', 'success');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello');
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].id).toBeDefined();
  });

  it('add() defaults to success type', () => {
    useToastStore.getState().add('Test');
    expect(useToastStore.getState().toasts[0].type).toBe('success');
  });

  it('add() supports error type', () => {
    useToastStore.getState().add('Error!', 'error');
    expect(useToastStore.getState().toasts[0].type).toBe('error');
  });

  it('add() supports warning type', () => {
    useToastStore.getState().add('Warn', 'warning');
    expect(useToastStore.getState().toasts[0].type).toBe('warning');
  });

  it('multiple add() calls accumulate toasts', () => {
    useToastStore.getState().add('One');
    useToastStore.getState().add('Two');
    useToastStore.getState().add('Three');
    expect(useToastStore.getState().toasts).toHaveLength(3);
  });

  it('remove() removes toast by id', () => {
    useToastStore.getState().add('Test');
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().remove(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('remove() only removes matching toast', () => {
    // Manually set toasts to avoid auto-remove timers
    useToastStore.setState({
      toasts: [
        { id: 'a', message: 'One', type: 'success' },
        { id: 'b', message: 'Two', type: 'success' },
      ],
    });
    useToastStore.getState().remove('a');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe('Two');
  });

  it('toast auto-removes after 3000ms', () => {
    useToastStore.getState().add('Auto');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('toast does not auto-remove before 3000ms', () => {
    useToastStore.getState().add('Wait');
    vi.advanceTimersByTime(2999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe('toast helper', () => {
  it('toast.success() creates success toast', () => {
    toast.success('OK');
    expect(useToastStore.getState().toasts[0].type).toBe('success');
    expect(useToastStore.getState().toasts[0].message).toBe('OK');
  });

  it('toast.error() creates error toast', () => {
    toast.error('Fail');
    expect(useToastStore.getState().toasts[0].type).toBe('error');
  });

  it('toast.warning() creates warning toast', () => {
    toast.warning('Caution');
    expect(useToastStore.getState().toasts[0].type).toBe('warning');
  });
});
