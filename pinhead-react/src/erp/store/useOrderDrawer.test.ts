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
  beforeEach(() => { useOrderDrawer.setState({ orderId: null, navigate: null }); });

  it('без навигатора работает по памяти: open ставит orderId, close очищает', () => {
    useOrderDrawer.getState().open('ord-1');
    expect(useOrderDrawer.getState().orderId).toBe('ord-1');
    useOrderDrawer.getState().close();
    expect(useOrderDrawer.getState().orderId).toBeNull();
  });

  it('с навигатором сам стейт не пишет — состояние приходит из адреса', () => {
    const navigate = vi.fn();
    useOrderDrawer.setState({ navigate });

    useOrderDrawer.getState().open('ord-2');
    expect(navigate).toHaveBeenCalledWith('ord-2');
    // до синхронизации с адресом карточка не открыта: иначе панель мигнула бы
    // раньше перехода и разошлась бы с историей браузера
    expect(useOrderDrawer.getState().orderId).toBeNull();

    useOrderDrawer.getState().syncFromUrl('ord-2');
    expect(useOrderDrawer.getState().orderId).toBe('ord-2');

    useOrderDrawer.getState().close();
    expect(navigate).toHaveBeenLastCalledWith(null);
    expect(useOrderDrawer.getState().orderId).toBe('ord-2');

    useOrderDrawer.getState().syncFromUrl(null);
    expect(useOrderDrawer.getState().orderId).toBeNull();
  });

  it('syncFromUrl не трогает стор, если значение не изменилось', () => {
    useOrderDrawer.setState({ orderId: 'ord-3' });
    const listener = vi.fn();
    const unsub = useOrderDrawer.subscribe(listener);
    useOrderDrawer.getState().syncFromUrl('ord-3');
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });
});

describe('orderLinkClick', () => {
  beforeEach(() => { useOrderDrawer.setState({ orderId: null, navigate: null }); });

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
