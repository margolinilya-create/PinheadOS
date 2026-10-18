import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nav, switchToProduction, withStudioOff } from './switchToProduction';
import { readStoredFeature, clearFeature, setFeature } from '../config/features';
import { useAuthStore } from '../store/useAuthStore';

const live = { active: true, approved: true };
const SELLER = { id: 's', role: 'manager', is_sales: true, ...live };
const ROP = { id: 'r', role: 'rop', ...live };
const ADMIN = { id: 'a', role: 'admin', ...live };
const DESIGNER = { id: 'g', role: 'designer', ...live };

describe('switchToProduction (веха 8, К1)', () => {
  let replace: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    clearFeature('orderStudio');
    replace = vi.spyOn(nav, 'replace').mockImplementation(() => {});
  });
  afterEach(() => {
    replace.mockRestore();
    clearFeature('orderStudio');
  });

  it.each([['продавец', SELLER], ['rop', ROP]])('%s уходит на один заход: ?studio=0, хранилище не тронуто', (_n, p) => {
    setFeature('orderStudio', true);
    switchToProduction('/', p);
    expect(replace).toHaveBeenCalledWith('/?studio=0');
    expect(readStoredFeature('orderStudio')).toBe('1');
  });

  it('продавец по ссылке после запуска — в карточку ERP с ?studio=0', () => {
    switchToProduction('/orders/erp-7', SELLER);
    expect(replace).toHaveBeenCalledWith('/orders/erp-7?studio=0');
    expect(readStoredFeature('orderStudio')).toBeNull();
  });

  it('admin запоминает выбор «0»', () => {
    switchToProduction('/', ADMIN);
    expect(readStoredFeature('orderStudio')).toBe('0');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('профиль без доступа (LeaveToProduction) запоминает «0» — петли нет', () => {
    switchToProduction('/', DESIGNER);
    expect(readStoredFeature('orderStudio')).toBe('0');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('по умолчанию профиль берётся из стора входа', () => {
    useAuthStore.setState({ user: SELLER as never });
    switchToProduction();
    expect(replace).toHaveBeenCalledWith('/?studio=0');
    useAuthStore.setState({ user: null });
  });

  it('чужой адрес не проходит', () => {
    switchToProduction('//evil.example/x', ADMIN);
    expect(replace).toHaveBeenLastCalledWith('/');
    switchToProduction('/\\evil.example/x', ADMIN);
    expect(replace).toHaveBeenLastCalledWith('/');
    switchToProduction('/\\evil.example/x', SELLER);
    expect(replace).toHaveBeenLastCalledWith('/?studio=0');
    expect(withStudioOff('https://evil.example')).toBe('/?studio=0');
  });

  it('withStudioOff сохраняет параметры и якорь', () => {
    expect(withStudioOff('/orders?tab=a#b')).toBe('/orders?tab=a&studio=0#b');
    expect(withStudioOff('/?studio=1')).toBe('/?studio=0');
  });
});
