import { describe, expect, it, vi } from 'vitest';
import type { MouseEvent } from 'react';
import { overlayClick } from './overlayClick';

function fakeEvent(onSelf: boolean) {
  const overlay = {};
  return {
    target: onSelf ? overlay : {},
    currentTarget: overlay,
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent<HTMLElement> & { stopPropagation: ReturnType<typeof vi.fn> };
}

describe('overlayClick', () => {
  it('закрывает окно кликом по самой подложке', () => {
    const onClose = vi.fn();
    overlayClick(onClose)(fakeEvent(true));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('не закрывает окно кликом внутри панели', () => {
    const onClose = vi.fn();
    overlayClick(onClose)(fakeEvent(false));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('гасит всплытие в обоих случаях — клик не доходит до предков окна', () => {
    const inside = fakeEvent(false);
    const outside = fakeEvent(true);
    overlayClick(vi.fn())(inside);
    overlayClick(vi.fn())(outside);
    expect(inside.stopPropagation).toHaveBeenCalled();
    expect(outside.stopPropagation).toHaveBeenCalled();
  });

  it('без обработчика закрытия только гасит всплытие', () => {
    const e = fakeEvent(true);
    expect(() => overlayClick()(e)).not.toThrow();
    expect(e.stopPropagation).toHaveBeenCalled();
  });
});
