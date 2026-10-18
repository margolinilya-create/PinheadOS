import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Загрузка справочников заказа в стор (веха 4, задача 1).
 *
 * Справочник — подсказка, а не условие работы: не загрузился или ключа ещё
 * нет (миграция G не применена) — заказ считается по сидам кода, и стор
 * помечает это `catalogSource: 'fallback'`, чтобы редактор не сохранил сиды
 * поверх базы. Прайс без права чтения (начальник цеха) не приходит вовсе —
 * расчёт идёт по `PRICES` из кода и не падает.
 */
const loadAllCatalogs = vi.fn();
vi.mock('../../lib/catalogs', () => ({ loadAllCatalogs: () => loadAllCatalogs() }));
// utils/pricing тянет useStore, а тот — этот слайс: без мока слайс, загруженный
// первым, видит недогруженный модуль (в приложении первым грузится useStore)
vi.mock('../../utils/pricing', () => ({ invalidatePricesCache: vi.fn() }));

const { catalogSlice } = await import('./catalogSlice');
const { SUPPLIERS_SEED, LABEL_LIBRARY_SEED, TZ_SETTINGS_SEED } = await import('../../orderstudio/catalog/seeds');
const { PRICES } = await import('../../data');
const { toast } = await import('../useToastStore');

type State = Record<string, unknown>;

function makeSlice() {
  let state: State = {};
  const set = (u: State | ((s: State) => State)) => {
    state = { ...state, ...(typeof u === 'function' ? u(state) : u) };
  };
  const slice = catalogSlice(set, () => state);
  state = { ...slice };
  return { get: () => state, load: () => (state.loadCatalogs as () => Promise<void>)() };
}

const DB_SUPPLIERS = [{ ...SUPPLIERS_SEED[1], name: 'Коттонпром (база)' }];
const DB_LABELS = { ...LABEL_LIBRARY_SEED, schemes: [] };
const DB_TZ = { footerText: 'Подвал из базы' };

describe('catalogSlice — справочники заказа', () => {
  beforeEach(() => {
    loadAllCatalogs.mockReset();
    vi.restoreAllMocks();
  });

  it('до загрузки — сиды и fallback', () => {
    const s = makeSlice().get();
    expect(s.suppliers).toEqual(SUPPLIERS_SEED);
    expect(s.labelLibrary).toEqual(LABEL_LIBRARY_SEED);
    expect(s.tzSettings).toEqual(TZ_SETTINGS_SEED);
    expect(s.catalogSource).toBe('fallback');
  });

  it('все три ключа из базы — db и значения базы', async () => {
    loadAllCatalogs.mockResolvedValue({ suppliers: DB_SUPPLIERS, labelLibrary: DB_LABELS, tzSettings: DB_TZ });
    const sl = makeSlice();
    await sl.load();
    expect(sl.get().suppliers).toEqual(DB_SUPPLIERS);
    expect(sl.get().labelLibrary).toEqual(DB_LABELS);
    expect(sl.get().tzSettings).toEqual(DB_TZ);
    expect(sl.get().catalogSource).toBe('db');
  });

  it('ключа нет (G не применена) — сиды этого ключа и fallback', async () => {
    loadAllCatalogs.mockResolvedValue({ suppliers: DB_SUPPLIERS, labelLibrary: DB_LABELS });
    const sl = makeSlice();
    await sl.load();
    expect(sl.get().suppliers).toEqual(DB_SUPPLIERS);
    expect(sl.get().tzSettings).toEqual(TZ_SETTINGS_SEED);
    expect(sl.get().catalogSource).toBe('fallback');
  });

  it('значение не той формы — сиды и fallback, а не мусор в сторе', async () => {
    loadAllCatalogs.mockResolvedValue({ suppliers: { not: 'array' }, labelLibrary: [], tzSettings: { footerText: 5 } });
    const sl = makeSlice();
    await sl.load();
    expect(sl.get().suppliers).toEqual(SUPPLIERS_SEED);
    expect(sl.get().labelLibrary).toEqual(LABEL_LIBRARY_SEED);
    expect(sl.get().tzSettings).toEqual(TZ_SETTINGS_SEED);
    expect(sl.get().catalogSource).toBe('fallback');
  });

  it('загрузка упала — сиды, fallback и прайс кода', async () => {
    vi.spyOn(toast, 'warning').mockImplementation(() => {});
    loadAllCatalogs.mockRejectedValue(new Error('down'));
    const sl = makeSlice();
    await sl.load();
    expect(sl.get().suppliers).toEqual(SUPPLIERS_SEED);
    expect(sl.get().catalogSource).toBe('fallback');
    expect(sl.get().prices).toBe(PRICES);
  });

  it('загрузка упала — зоны из ZONES_CATALOG_DEFAULT, зеркало ph_zones не читается (веха 5б, решение 24)', async () => {
    vi.spyOn(toast, 'warning').mockImplementation(() => {});
    const { ZONES_CATALOG_DEFAULT } = await import('../../data');
    const { storageSet, storageGet } = await import('../../lib/storage');
    storageSet('ph_zones', [{ id: 'stale', name: 'Устаревшая' }]);
    expect(storageGet('ph_zones')).toEqual([{ id: 'stale', name: 'Устаревшая' }]);
    loadAllCatalogs.mockRejectedValue(new Error('down'));
    const sl = makeSlice();
    await sl.load();
    expect(sl.get().zonesCatalog).toBe(ZONES_CATALOG_DEFAULT);
  });

  it('прайс не пришёл (нет права) — расчёт по PRICES кода, без падения', async () => {
    loadAllCatalogs.mockResolvedValue({
      suppliers: DB_SUPPLIERS, labelLibrary: DB_LABELS, tzSettings: DB_TZ, skuCatalog: [{ code: 'T1' }],
    });
    const sl = makeSlice();
    await sl.load();
    expect(sl.get().prices).toBe(PRICES);
    expect(sl.get().usdRate).toBe((PRICES as Record<string, unknown>).usdRate);
    expect(sl.get().skuCatalog).toEqual([{ code: 'T1' }]);
  });

  it('прайс из базы поверх кода: новые ключи правил цены приходят в стор', async () => {
    const packOptions = [{ key: 'zip', name: 'ЗИП', price: 45 }];
    loadAllCatalogs.mockResolvedValue({ prices: { packOptions, minMarginPct: 12 } });
    const sl = makeSlice();
    await sl.load();
    const p = sl.get().prices as Record<string, unknown>;
    expect(p.packOptions).toEqual(packOptions);
    expect(p.minMarginPct).toBe(12);
    expect(p.dtfSteps).toEqual((PRICES as Record<string, unknown>).dtfSteps);
  });
});
