import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOrderDrawer, orderLinkClick } from './useOrderDrawer';

/** Минимальный фейк MouseEvent для orderLinkClick (проверяем рантайм-логику, не типы). */
type FakeMouseEvent = {
  metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number;
  preventDefault: () => void; stopPropagation: () => void;
};
type LinkClickEvent = Parameters<typeof orderLinkClick>[1];

function makeEvent(overrides: Partial<FakeMouseEvent> = {}): FakeMouseEvent {
  return {
    metaKey: false, ctrlKey: false, shiftKey: false, button: 0,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    ...overrides,
  };
}

describe('useOrderDrawer', () => {
  beforeEach(() => { useOrderDrawer.setState({ orderId: null }); });

  it('open ставит orderId, close очищает', () => {
    useOrderDrawer.getState().open('ord-1');
    expect(useOrderDrawer.getState().orderId).toBe('ord-1');
    useOrderDrawer.getState().close();
    expect(useOrderDrawer.getState().orderId).toBeNull();
  });
});

describe('orderLinkClick', () => {
  beforeEach(() => { useOrderDrawer.setState({ orderId: null }); });

  it('обычный ЛКМ открывает Drawer и гасит навигацию', () => {
    const e = makeEvent();
    orderLinkClick('ord-9', e as unknown as LinkClickEvent);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(useOrderDrawer.getState().orderId).toBe('ord-9');
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['middle button', { button: 1 }],
  ] as const)('модификатор %s → отдаём навигацию браузеру, Drawer не открывается', (_label, ov) => {
    const e = makeEvent(ov);
    orderLinkClick('ord-9', e as unknown as LinkClickEvent);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled(); // всплытие гасим — строка не тогглится
    expect(useOrderDrawer.getState().orderId).toBeNull();
  });
});
