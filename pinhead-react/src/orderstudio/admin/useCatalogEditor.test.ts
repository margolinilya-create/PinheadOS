import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { fetchCatalogKey, clearCatalogsCache } from '../../lib/catalogs';
import { putCatalog, patchPrices } from '../api/catalogAdmin';
import { catalogHasUnsaved } from '../leaveGuard';
import { useStore } from '../../store/useStore';
import { useCatalogEditor, sameJson } from './useCatalogEditor';

vi.mock('../../lib/catalogs', () => ({
  fetchCatalogKey: vi.fn(),
  clearCatalogsCache: vi.fn(),
  loadAllCatalogs: vi.fn().mockResolvedValue({}),
}));
vi.mock('../api/catalogAdmin', () => ({
  putCatalog: vi.fn(),
  patchPrices: vi.fn(),
}));

const fetchMock = vi.mocked(fetchCatalogKey);
const putMock = vi.mocked(putCatalog);
const patchMock = vi.mocked(patchPrices);

const DB = { footerText: 'Подвал из базы' };

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ exists: true, value: DB });
});

async function ready(table: 'catalog_config' | 'app_config' = 'app_config', key = 'tzSettings') {
  const hook = renderHook(() => useCatalogEditor(table as 'app_config', key as 'tzSettings'));
  await waitFor(() => expect(hook.result.current.state).not.toBe('loading'));
  return hook;
}

describe('sameJson — смысловое равенство справочника', () => {
  it('порядок ключей не важен, массивы — по порядку', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });
});

describe('useCatalogEditor — загрузка', () => {
  it('свежий запрос мимо кэша; база — значение из загрузки', async () => {
    const { result } = await ready();
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'tzSettings');
    expect(result.current.state).toBe('ready');
    expect(result.current.value).toEqual(DB);
    expect(result.current.dirty).toBe(false);
  });

  it('правка делает справочник изменённым; возврат к базе — нет', async () => {
    const { result } = await ready();
    act(() => result.current.setValue({ footerText: 'Новый' }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setValue((v: unknown) => ({ ...(v as object), footerText: 'Подвал из базы' })));
    expect(result.current.dirty).toBe(false);
  });
});

describe('useCatalogEditor — сохранение', () => {
  it('успех: catalog_put с базой загрузки, стор обновлён, правок больше нет', async () => {
    putMock.mockResolvedValue({ ok: true });
    const { result } = await ready();
    const next = { footerText: 'Новый подвал' };
    act(() => result.current.setValue(next));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(true);
    expect(putMock).toHaveBeenCalledWith('app_config', 'tzSettings', next, DB);
    expect(result.current.state).toBe('ready');
    expect(result.current.dirty).toBe(false);
    expect((useStore.getState() as unknown as Record<string, unknown>).tzSettings).toEqual(next);
  });

  it('конфликт: кэш сброшен, правки на месте, сохранение закрыто до свежей версии', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'Справочник изменён — загрузите свежую версию' });
    const { result } = await ready();
    act(() => result.current.setValue({ footerText: 'Моя правка' }));
    await act(async () => { await result.current.save(); });
    expect(result.current.state).toBe('conflict');
    expect(clearCatalogsCache).toHaveBeenCalled();
    expect(result.current.value).toEqual({ footerText: 'Моя правка' });
    expect(result.current.dirty).toBe(true);

    // Повтор поверх чужой версии не уходит
    putMock.mockClear();
    let again: boolean | undefined;
    await act(async () => { again = await result.current.save(); });
    expect(again).toBe(false);
    expect(putMock).not.toHaveBeenCalled();

    // «Загрузить свежую версию» — новая база, снова можно сохранять
    const fresh = { footerText: 'Чужая правка' };
    fetchMock.mockResolvedValue({ exists: true, value: fresh });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.value).toEqual(fresh);
    putMock.mockResolvedValue({ ok: true });
    act(() => result.current.setValue({ footerText: 'Моя правка' }));
    await act(async () => { await result.current.save(); });
    expect(putMock).toHaveBeenCalledWith('app_config', 'tzSettings', { footerText: 'Моя правка' }, fresh);
  });

  it('отказ права или формы — состояние error, правки остаются, повтор возможен', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'forbidden', message: 'нет права' });
    const { result } = await ready();
    act(() => result.current.setValue({ footerText: 'X' }));
    await act(async () => { await result.current.save(); });
    expect(result.current.state).toBe('error');
    expect(result.current.dirty).toBe(true);
    putMock.mockResolvedValue({ ok: true });
    await act(async () => { await result.current.save(); });
    expect(result.current.state).toBe('ready');
  });

  it('прайс: prices_patch только изменённых верхних ключей с их прежними значениями', async () => {
    const base = { usdRate: 90, packOptions: [{ key: 'none', name: 'Без упаковки', price: 0 }], minMarginPct: null };
    fetchMock.mockResolvedValue({ exists: true, value: base });
    patchMock.mockResolvedValue({ ok: true });
    const { result } = await ready('app_config', 'prices');
    act(() => result.current.setValue({ ...base, minMarginPct: 20 }));
    await act(async () => { await result.current.save(); });
    expect(patchMock).toHaveBeenCalledWith({ minMarginPct: 20 }, { minMarginPct: null });
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe('useCatalogEditor — запасной путь', () => {
  it('справочник не загрузился: показ встроенного значения, сохранение заблокировано', async () => {
    fetchMock.mockResolvedValue(null);
    const { result } = await ready();
    expect(result.current.state).toBe('fallback');
    expect(result.current.value).toEqual((useStore.getState() as unknown as Record<string, unknown>).tzSettings);
    act(() => result.current.setValue({ footerText: 'Сид поверх базы' }));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(false);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('строки нет в базе — тоже запасной путь (сиды поверх базы не пишутся)', async () => {
    fetchMock.mockResolvedValue({ exists: false, value: null });
    const { result } = await ready('catalog_config', 'suppliers');
    expect(result.current.state).toBe('fallback');
    await act(async () => { await result.current.save(); });
    expect(putMock).not.toHaveBeenCalled();
  });

  it('«Загрузить снова» после сбоя — свежая версия, сохранять можно', async () => {
    fetchMock.mockResolvedValueOnce(null);
    const { result } = await ready();
    expect(result.current.state).toBe('fallback');
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.value).toEqual(DB);
  });
});

describe('useCatalogEditor — уход с несохранённым', () => {
  it('правки отмечаются для подтверждения ухода и снимаются при сохранении и размонтировании', async () => {
    putMock.mockResolvedValue({ ok: true });
    const { result, unmount } = await ready();
    expect(catalogHasUnsaved()).toBe(false);
    act(() => result.current.setValue({ footerText: 'Y' }));
    expect(catalogHasUnsaved()).toBe(true);
    await act(async () => { await result.current.save(); });
    expect(catalogHasUnsaved()).toBe(false);
    act(() => result.current.setValue({ footerText: 'Z' }));
    expect(catalogHasUnsaved()).toBe(true);
    unmount();
    expect(catalogHasUnsaved()).toBe(false);
  });
});
