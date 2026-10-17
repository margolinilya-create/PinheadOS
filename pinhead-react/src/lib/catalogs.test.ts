import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storage
vi.mock('./storage', () => ({
  sessionGet: vi.fn(() => null),
  sessionSet: vi.fn(),
  sessionRemove: vi.fn(),
}));

// Mock supabase
const mockCatalogSelect = vi.fn();
const mockAppSelect = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: table === 'catalog_config' ? mockCatalogSelect : mockAppSelect,
    })),
  },
}));

const { loadAllCatalogs, clearCatalogsCache, fetchCatalogKey } = await import('./catalogs');
const { sessionGet, sessionRemove } = await import('./storage');
const { toast } = await import('../store/useToastStore');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  (sessionGet as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

describe('loadAllCatalogs', () => {
  it('returns cached data when session cache is valid', async () => {
    const cached = { skuCatalog: [{ code: 'T1' }] };
    (sessionGet as ReturnType<typeof vi.fn>).mockReturnValue(cached);

    const result = await loadAllCatalogs();
    expect(result).toBe(cached);
    expect(mockCatalogSelect).not.toHaveBeenCalled();
    expect(mockAppSelect).not.toHaveBeenCalled();
  });

  it('fetches and merges catalog_config + app_config', async () => {
    mockCatalogSelect.mockResolvedValue({
      data: [{ key: 'fabricsCatalog', value: [{ id: 'f1' }] }],
      error: null,
    });
    mockAppSelect.mockResolvedValue({
      data: [{ key: 'sku_catalog', value: [{ code: 'T1' }] }],
      error: null,
    });

    const result = await loadAllCatalogs();
    expect(result.fabricsCatalog).toEqual([{ id: 'f1' }]);
    expect(result.skuCatalog).toEqual([{ code: 'T1' }]);
  });

  it('succeeds with partial failure (catalog_config fails)', async () => {
    mockCatalogSelect.mockResolvedValue({
      data: null,
      error: { message: 'connection refused' },
    });
    mockAppSelect.mockResolvedValue({
      data: [{ key: 'sku_catalog', value: [{ code: 'T1' }] }],
      error: null,
    });

    const result = await loadAllCatalogs();
    expect(result.skuCatalog).toEqual([{ code: 'T1' }]);
  });

  it('throws when both tables fail', async () => {
    const err = { message: 'both down' };
    mockCatalogSelect.mockResolvedValue({ data: null, error: err });
    mockAppSelect.mockResolvedValue({ data: null, error: { message: 'also down' } });

    await expect(loadAllCatalogs()).rejects.toEqual(err);
  });
});

describe('loadAllCatalogs — дедупликация запросов', () => {
  /**
   * loadCatalogs() зовётся и из main.jsx, и из OrderStudioApp, а StrictMode
   * дублирует эффекты. Кэш пишется только ПОСЛЕ ответа, поэтому без
   * промиса-синглтона на холодном старте уходило до 4 параллельных запросов.
   */
  it('параллельные вызовы переиспользуют один запрос', async () => {
    let release: (v: unknown) => void = () => {};
    const pending = new Promise((res) => { release = res; });
    mockCatalogSelect.mockReturnValue(pending);
    mockAppSelect.mockReturnValue(pending);

    const all = Promise.all([loadAllCatalogs(), loadAllCatalogs(), loadAllCatalogs()]);
    // по одному select на таблицу, а не по три
    expect(mockCatalogSelect).toHaveBeenCalledTimes(1);
    expect(mockAppSelect).toHaveBeenCalledTimes(1);

    release({ data: [], error: null });
    await all;
  });

  it('после завершения следующий вызов идёт в сеть заново', async () => {
    mockCatalogSelect.mockResolvedValue({ data: [], error: null });
    mockAppSelect.mockResolvedValue({ data: [], error: null });

    await loadAllCatalogs();
    expect(mockCatalogSelect).toHaveBeenCalledTimes(1);

    await loadAllCatalogs();
    expect(mockCatalogSelect).toHaveBeenCalledTimes(2);
  });

  it('после ошибки синглтон сбрасывается — повтор снова идёт в сеть', async () => {
    mockCatalogSelect.mockResolvedValue({ data: null, error: { message: 'down' } });
    mockAppSelect.mockResolvedValue({ data: null, error: { message: 'down' } });

    await expect(loadAllCatalogs()).rejects.toBeTruthy();
    await expect(loadAllCatalogs()).rejects.toBeTruthy();
    expect(mockCatalogSelect).toHaveBeenCalledTimes(2);
  });
});

describe('clearCatalogsCache', () => {
  it('removes session cache key', () => {
    clearCatalogsCache();
    expect(sessionRemove).toHaveBeenCalledWith('pinhead_catalogs_v1');
  });
});

describe('fetchCatalogKey — свежее чтение мимо кэша (редакторы справочников, веха 4)', () => {
  const chain = (res: unknown) => {
    const maybeSingle = vi.fn().mockResolvedValue(res);
    const eq = vi.fn(() => ({ maybeSingle }));
    return { eq, maybeSingle };
  };

  it('читает одну строку нужной таблицы по ключу и не трогает кэш', async () => {
    const c = chain({ data: { key: 'suppliers', value: [{ id: 'medastex' }] }, error: null });
    mockCatalogSelect.mockReturnValue({ eq: c.eq });
    (sessionGet as ReturnType<typeof vi.fn>).mockReturnValue({ suppliers: 'из кэша' });

    const res = await fetchCatalogKey('catalog_config', 'suppliers');
    expect(res).toEqual({ exists: true, value: [{ id: 'medastex' }] });
    expect(mockCatalogSelect).toHaveBeenCalledWith('key, value');
    expect(c.eq).toHaveBeenCalledWith('key', 'suppliers');
    expect(mockAppSelect).not.toHaveBeenCalled();
  });

  it('строки нет — exists: false, value: null', async () => {
    const c = chain({ data: null, error: null });
    mockAppSelect.mockReturnValue({ eq: c.eq });
    expect(await fetchCatalogKey('app_config', 'tzSettings')).toEqual({ exists: false, value: null });
  });

  it('ошибка Supabase — toast.error и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = chain({ data: null, error: { message: 'permission denied for table app_config' } });
    mockAppSelect.mockReturnValue({ eq: c.eq });
    expect(await fetchCatalogKey('app_config', 'labelLibrary')).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('отказ сети — toast.error и null, без исключения', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAppSelect.mockReturnValue({ eq: () => ({ maybeSingle: () => Promise.reject(new TypeError('Failed to fetch')) }) });
    expect(await fetchCatalogKey('app_config', 'labelLibrary')).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });
});
