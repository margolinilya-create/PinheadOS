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

const { loadAllCatalogs, clearCatalogsCache } = await import('./catalogs');
const { sessionGet, sessionRemove } = await import('./storage');

beforeEach(() => {
  vi.clearAllMocks();
  (sessionGet as ReturnType<typeof vi.fn>).mockReturnValue(null);
  clearCatalogsCache(); // сброс dedup-промиса между тестами
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

describe('clearCatalogsCache', () => {
  it('removes session cache key', () => {
    clearCatalogsCache();
    expect(sessionRemove).toHaveBeenCalledWith('pinhead_catalogs_v1');
  });
});
