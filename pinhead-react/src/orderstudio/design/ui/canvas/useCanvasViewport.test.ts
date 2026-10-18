import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDesignStore } from '../../store/useDesignStore';
import { FLAT_MM_FALLBACK } from './canvasMath';
import { DEFAULT_STAGE, WHEEL_STEP, ZOOM_STEP, useCanvasViewport, type WheelLike } from './useCanvasViewport';

function setup(el: HTMLElement | null = null) {
  const ref = { current: el };
  return renderHook(() => useCanvasViewport(ref, FLAT_MM_FALLBACK));
}

function wheel(deltaY: number, ctrl: boolean, pointer = { x: 100, y: 50 }) {
  const preventDefault = vi.fn<() => void>();
  const e: WheelLike = {
    evt: { ctrlKey: ctrl, metaKey: false, deltaY, preventDefault },
    target: { getStage: () => ({ getPointerPosition: () => pointer }) },
  };
  return { e, preventDefault };
}

beforeEach(() => {
  useDesignStore.getState().reset();
});

describe('useCanvasViewport', () => {
  it('без ResizeObserver и размера контейнера — стейдж по умолчанию, развёртка конечна', () => {
    const { result } = setup(document.createElement('div'));
    expect(result.current.size).toEqual(DEFAULT_STAGE);
    expect(result.current.t.pxPerMM).toBeGreaterThan(0);
  });

  it('кнопки масштаба: шаг 1,2 вокруг центра, «вписать» — 100 % без панорамы', () => {
    const { result } = setup();
    act(() => result.current.zoomBy(1));
    expect(useDesignStore.getState().zoom).toBeCloseTo(ZOOM_STEP, 6);
    // центр стейджа остался на месте
    const { pan } = useDesignStore.getState();
    expect((DEFAULT_STAGE.width / 2 - pan.x) / ZOOM_STEP).toBeCloseTo(DEFAULT_STAGE.width / 2, 6);
    act(() => result.current.fit());
    expect(useDesignStore.getState().zoom).toBe(1);
    expect(useDesignStore.getState().pan).toEqual({ x: 0, y: 0 });
  });

  it('простое колесо листает страницу: не гасится и масштаб не меняет', () => {
    const { result } = setup();
    const { e, preventDefault } = wheel(-100, false);
    act(() => result.current.onWheel(e));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(useDesignStore.getState().zoom).toBe(1);
  });

  it('Ctrl+колесо — масштаб к курсору, событие погашено', () => {
    const { result } = setup();
    const { e, preventDefault } = wheel(-100, true);
    act(() => result.current.onWheel(e));
    expect(preventDefault).toHaveBeenCalled();
    expect(useDesignStore.getState().zoom).toBeCloseTo(WHEEL_STEP, 6);
    const { pan } = useDesignStore.getState();
    expect((100 - pan.x) / WHEEL_STEP).toBeCloseTo(100, 6);
  });

  it('масштаб не выходит за пределы стора', () => {
    const { result } = setup();
    for (let i = 0; i < 40; i += 1) act(() => result.current.zoomBy(1));
    expect(useDesignStore.getState().zoom).toBe(8);
  });

  it('панорама пишется, только если тащили сам стейдж', () => {
    const { result } = setup();
    const stage = { x: () => 30, y: () => -10, getStage: () => stage };
    const node = { x: () => 5, y: () => 5, getStage: () => stage };
    act(() => result.current.onStageDragEnd({ target: node }));
    expect(useDesignStore.getState().pan).toEqual({ x: 0, y: 0 });
    act(() => result.current.onStageDragEnd({ target: stage }));
    expect(useDesignStore.getState().pan).toEqual({ x: 30, y: -10 });
  });

  it('toMm: без контейнера — null, с контейнером — мм флэта', () => {
    expect(setup().result.current.toMm(10, 10)).toBeNull();
    const el = document.createElement('div');
    const { result } = setup(el);
    const { t } = result.current;
    const mm = result.current.toMm(t.px(300), t.py(100))!;
    expect(mm.x_mm).toBeCloseTo(300, 6);
    expect(mm.y_mm).toBeCloseTo(100, 6);
  });
});
