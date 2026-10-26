import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { keyAction, ROTATION_SNAPS, SHIFT_ROTATION_SNAPS, useCanvasKeys, useRotationSnap, type KeyLike } from './useCanvasKeys';

const k = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra,
});
const EDIT = { readOnly: false, hasSelection: true };

describe('keyAction — Ctrl+D (веха 5в, Э2)', () => {
  it('Ctrl/Cmd+D — дубль при выборе; по коду — и на «в»; без выбора и в только чтении — нет; Ctrl+V здесь не ловится', () => {
    expect(keyAction(k('d', { ctrlKey: true, code: 'KeyD' }), EDIT)).toEqual({ type: 'duplicate' });
    expect(keyAction(k('в', { metaKey: true }), EDIT)).toEqual({ type: 'duplicate' });
    expect(keyAction(k('d', { ctrlKey: true, code: 'KeyD' }), { ...EDIT, hasSelection: false })).toBeNull();
    expect(keyAction(k('d', { ctrlKey: true, code: 'KeyD' }), { ...EDIT, readOnly: true })).toBeNull();
    expect(keyAction(k('v', { ctrlKey: true, code: 'KeyV' }), EDIT)).toBeNull();
    expect(keyAction(k('c', { ctrlKey: true, code: 'KeyC' }), EDIT)).toBeNull();
  });
});

describe('keyAction', () => {
  it('стрелки: 1 мм, с Shift — 10 мм; без выбора — ничего', () => {
    expect(keyAction(k('ArrowLeft'), EDIT)).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(keyAction(k('ArrowDown', { shiftKey: true }), EDIT)).toEqual({ type: 'nudge', dx: 0, dy: 10 });
    expect(keyAction(k('ArrowUp'), { ...EDIT, hasSelection: false })).toBeNull();
  });

  it('Ctrl/Cmd+Z — отменить, с Shift или Ctrl+Y — вернуть; русская раскладка по коду клавиши', () => {
    expect(keyAction(k('z', { ctrlKey: true }), EDIT)).toEqual({ type: 'undo' });
    expect(keyAction(k('Z', { metaKey: true, shiftKey: true }), EDIT)).toEqual({ type: 'redo' });
    expect(keyAction(k('я', { ctrlKey: true, code: 'KeyZ' }), EDIT)).toEqual({ type: 'undo' });
    expect(keyAction(k('н', { ctrlKey: true, code: 'KeyY' }), EDIT)).toEqual({ type: 'redo' });
  });

  it('Delete и Backspace — «Снять с изделия» выбранного', () => {
    expect(keyAction(k('Delete'), EDIT)).toEqual({ type: 'unplace' });
    expect(keyAction(k('Backspace'), EDIT)).toEqual({ type: 'unplace' });
    expect(keyAction(k('Delete'), { ...EDIT, hasSelection: false })).toBeNull();
  });

  it('только чтение: правки нет, выбор и масштаб есть', () => {
    const RO = { readOnly: true, hasSelection: true };
    expect(keyAction(k('ArrowLeft'), RO)).toBeNull();
    expect(keyAction(k('Delete'), RO)).toBeNull();
    expect(keyAction(k('z', { ctrlKey: true }), RO)).toBeNull();
    expect(keyAction(k('Escape'), RO)).toEqual({ type: 'deselect' });
    expect(keyAction(k('+'), RO)).toEqual({ type: 'zoom', dir: 1 });
    expect(keyAction(k('-'), RO)).toEqual({ type: 'zoom', dir: -1 });
    expect(keyAction(k('0'), RO)).toEqual({ type: 'fit' });
  });

  it('чужие сочетания не перехватываются (Ctrl+C, Ctrl+V, Alt+стрелка, Tab)', () => {
    expect(keyAction(k('c', { ctrlKey: true }), EDIT)).toBeNull();
    expect(keyAction(k('v', { ctrlKey: true }), EDIT)).toBeNull();
    expect(keyAction(k('ArrowLeft', { altKey: true }), EDIT)).toBeNull();
    expect(keyAction(k('Tab'), EDIT)).toBeNull();
    expect(keyAction(k('Escape'), { ...EDIT, hasSelection: false })).toBeNull();
  });
});

describe('useCanvasKeys', () => {
  function setup(readOnly = false) {
    const handlers = { onSelect: vi.fn(), onCommit: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), zoomBy: vi.fn(), fit: vi.fn() };
    const { result } = renderHook(() => useCanvasKeys({ readOnly, selectedKey: 'p1', ...handlers }));
    const press = (key: string, extra: Partial<KeyLike> = {}) => {
      const e = { ...k(key, extra), preventDefault: vi.fn() };
      result.current(e);
      return e;
    };
    return { handlers, press };
  }

  it('стрелка → правка «Сдвиг» с ключом слияния; событие погашено', () => {
    const { handlers, press } = setup();
    const e = press('ArrowRight', { shiftKey: true });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(handlers.onCommit).toHaveBeenCalledWith({ kind: 'nudge', key: 'p1', dx_mm: 10, dy_mm: 0, label: 'Сдвиг', coalesceKey: 'nudge:p1' });
  });

  it('Delete → «Снять с изделия»; Esc → снять выбор; Ctrl+Z → отмена', () => {
    const { handlers, press } = setup();
    press('Delete');
    expect(handlers.onCommit).toHaveBeenCalledWith({ kind: 'unplace', key: 'p1', label: 'Снять с изделия' });
    press('Escape');
    expect(handlers.onSelect).toHaveBeenCalledWith(null);
    press('z', { ctrlKey: true });
    expect(handlers.onUndo).toHaveBeenCalled();
  });

  it('только чтение — ни одной правки; неизвестная клавиша не гасится', () => {
    const { handlers, press } = setup(true);
    press('ArrowRight');
    press('Delete');
    press('z', { ctrlKey: true });
    expect(handlers.onCommit).not.toHaveBeenCalled();
    expect(handlers.onUndo).not.toHaveBeenCalled();
    expect(press('q').preventDefault).not.toHaveBeenCalled();
  });
});

describe('useRotationSnap — Shift: поворот шагом 15°', () => {
  it('Shift зажат — шаг 15°, отпущен — прежние углы', () => {
    const tr = { rotationSnaps: vi.fn(), rotationSnapTolerance: vi.fn() };
    const ref = { current: tr };
    const { unmount } = renderHook(() => useRotationSnap(ref));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(tr.rotationSnaps).toHaveBeenLastCalledWith(SHIFT_ROTATION_SNAPS);
    expect(SHIFT_ROTATION_SNAPS).toContain(15);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(tr.rotationSnaps).toHaveBeenLastCalledWith(ROTATION_SNAPS);
    unmount();
    tr.rotationSnaps.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(tr.rotationSnaps).not.toHaveBeenCalled();
  });
});
