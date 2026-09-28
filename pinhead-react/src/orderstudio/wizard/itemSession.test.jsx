import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import { useDraft } from '../../hooks/useDraft';
import { beginItemSession, endItemSession, isItemSessionActive } from './itemSession';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';

const SKU = SKU_CATALOG_DEFAULT[2];

/** Недоделанный заказ главного визарда на `/` */
const MAIN = {
  step: 3, maxStep: 3, name: 'Клиент главного визарда', color: '01-01', fabric: 'medas-kulirnaya-100-180',
  items: [{ type: 'tee', color: '01-01' }], activeItemIdx: 0, deadline: '2026-10-10', saved: false,
};

beforeEach(() => {
  endItemSession();
  useStore.setState(JSON.parse(JSON.stringify(MAIN)));
});
afterEach(() => {
  endItemSession();
  vi.useRealTimers();
});

const pick = (keys) => {
  const s = useStore.getState();
  return Object.fromEntries(keys.map((k) => [k, s[k]]));
};

describe('сессия позиции v4 внутри общего стора визарда', () => {
  it('пустая позиция: шаг 0, поля по умолчанию, позиции главного визарда спрятаны', () => {
    beginItemSession();
    expect(isItemSessionActive()).toBe(true);
    expect(pick(['step', 'color', 'fabric', 'items', 'activeItemIdx'])).toEqual({
      step: 0, color: '', fabric: '', items: [], activeItemIdx: -1,
    });
  });

  it('выход возвращает главный визард как был', () => {
    beginItemSession();
    useStore.setState({ color: '15-01', step: 1, items: [{ type: 'hoodie' }] });
    endItemSession();
    expect(isItemSessionActive()).toBe(false);
    expect(pick(Object.keys(MAIN))).toEqual(MAIN);
  });

  it('правка: модель ставится штатным выбором визарда, поля позиции — поверх', () => {
    beginItemSession({ sku: SKU, fabric: 'medas-kulirnaya-100-160', color: '02-01', zones: ['back'] });
    const s = useStore.getState();
    expect(s.sku.code).toBe(SKU.code);
    expect(s.type).not.toBe('');
    expect(pick(['fabric', 'color', 'zones', 'maxStep'])).toEqual({
      fabric: 'medas-kulirnaya-100-160', color: '02-01', zones: ['back'], maxStep: 1,
    });
  });

  it('повторный вход без выхода не теряет главный визард', () => {
    beginItemSession();
    beginItemSession();
    endItemSession();
    expect(pick(Object.keys(MAIN))).toEqual(MAIN);
  });

  it('пока идёт сессия, черновик главного визарда в localStorage не перезаписывается', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    renderHook(() => useDraft());
    act(() => { beginItemSession(); });
    act(() => { useStore.setState({ color: '15-01', name: 'позиция v4' }); });
    act(() => { vi.advanceTimersByTime(2000); });
    const draftWrites = setItem.mock.calls.filter(([k]) => k === 'pinhead_draft');
    expect(draftWrites.every(([, v]) => !String(v).includes('позиция v4'))).toBe(true);
    act(() => { endItemSession(); });
    act(() => { vi.advanceTimersByTime(2000); });
    const last = setItem.mock.calls.filter(([k]) => k === 'pinhead_draft').at(-1);
    expect(String(last?.[1])).toContain('Клиент главного визарда');
    setItem.mockRestore();
  });
});
