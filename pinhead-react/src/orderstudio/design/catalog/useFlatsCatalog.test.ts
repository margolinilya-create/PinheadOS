import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { runAppResets } from '../../../store/appReset';
import { catalog, clone, flat } from '../fixtures.testutil';
import { FLATS_CACHE_MS, MSG_FLATS_FAILED, __resetFlatsCatalogForTests, loadFlatsCatalog, useFlatsCatalog } from './useFlatsCatalog';

const lib = vi.hoisted(() => ({ fetchCatalogKey: vi.fn() }));
vi.mock('../../../lib/catalogs', () => lib);
const upd = vi.hoisted(() => ({ handlePossibleUpdate: vi.fn(() => false) }));
vi.mock('../../../lib/appUpdate', () => upd);
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../../store/useToastStore', () => ({ toast }));

const row = (value: unknown) => ({ exists: true, value });

beforeEach(() => {
  __resetFlatsCatalogForTests();
  lib.fetchCatalogKey.mockReset();
  upd.handlePossibleUpdate.mockReset();
  upd.handlePossibleUpdate.mockReturnValue(false);
  toast.error.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('loadFlatsCatalog', () => {
  it('свежий запрос app_config.garmentFlats и терпимый разбор', async () => {
    const broken = clone(flat({ id: 'broken' }));
    broken.views[0].svg_path = 'flats/other/v1/front.svg';
    lib.fetchCatalogKey.mockResolvedValue(row({ version: 1, flats: [flat(), broken] }));
    const res = await loadFlatsCatalog();
    expect(lib.fetchCatalogKey).toHaveBeenCalledWith('app_config', 'garmentFlats');
    expect(res?.catalog.flats.map((f) => f.id)).toEqual(['tshirt-test']);
    expect(res?.issues.join(' ')).toMatch(/broken.*путь SVG/);
  });

  it('строки нет — пустой справочник без замечаний; пустой не кэшируется', async () => {
    lib.fetchCatalogKey.mockResolvedValue({ exists: false, value: null });
    expect(await loadFlatsCatalog()).toEqual({ catalog: { version: 1, flats: [] }, issues: [] });
    await loadFlatsCatalog();
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(2);
  });

  it('ошибка запроса — null (тост даёт fetchCatalogKey)', async () => {
    lib.fetchCatalogKey.mockResolvedValue(null);
    expect(await loadFlatsCatalog()).toBeNull();
  });

  it('кэш 10 минут; force — мимо кэша; выход сбрасывает', async () => {
    vi.useFakeTimers();
    lib.fetchCatalogKey.mockResolvedValue(row(catalog()));
    await loadFlatsCatalog();
    await loadFlatsCatalog();
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(1);
    await loadFlatsCatalog({ force: true });
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(FLATS_CACHE_MS);
    await loadFlatsCatalog();
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(3);
    runAppResets();
    await loadFlatsCatalog();
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(4);
  });

  it('ответ, запрошенный до выхода, в кэш не ложится', async () => {
    let finish!: (v: unknown) => void;
    lib.fetchCatalogKey.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    const pending = loadFlatsCatalog();
    runAppResets();
    finish(row(catalog()));
    await pending;
    lib.fetchCatalogKey.mockResolvedValue(row(catalog()));
    await loadFlatsCatalog();
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(2);
  });
});

describe('useFlatsCatalog', () => {
  it('loading → ready; reload — свежий запрос', async () => {
    lib.fetchCatalogKey.mockResolvedValue(row(catalog()));
    const { result } = renderHook(() => useFlatsCatalog());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.catalog.flats).toHaveLength(1);
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(2);
  });

  it('из кэша — сразу ready, без мигания «загрузки»', async () => {
    lib.fetchCatalogKey.mockResolvedValue(row(catalog()));
    await loadFlatsCatalog();
    const { result } = renderHook(() => useFlatsCatalog());
    expect(result.current.status).toBe('ready');
    expect(lib.fetchCatalogKey).toHaveBeenCalledTimes(1);
  });

  it('ошибка — error', async () => {
    lib.fetchCatalogKey.mockResolvedValue(null);
    const { result } = renderHook(() => useFlatsCatalog());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('чанк схемы не загрузился (устаревшая вкладка) — error, а не вечная загрузка; диалог обновления или тост', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lib.fetchCatalogKey.mockResolvedValue(row(catalog()));
    vi.doMock('./flatsSchema', () => { throw new Error('Failed to fetch dynamically imported module'); });
    try {
      upd.handlePossibleUpdate.mockReturnValue(true);
      const { result } = renderHook(() => useFlatsCatalog());
      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(upd.handlePossibleUpdate).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      upd.handlePossibleUpdate.mockReturnValue(false);
      await expect(loadFlatsCatalog()).resolves.toBeNull();
      expect(toast.error).toHaveBeenCalledWith(MSG_FLATS_FAILED);
    } finally {
      vi.doUnmock('./flatsSchema');
      vi.mocked(console.error).mockRestore();
    }
    const { result } = renderHook(() => useFlatsCatalog());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
