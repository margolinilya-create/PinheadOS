import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import * as catalogs from '../../lib/catalogs';
import { putCatalog, patchPrices, CONFLICT_MESSAGE } from './catalogAdmin';

/**
 * Запись справочников — только RPC миграции G: `catalog_put` и `prices_patch`.
 * Ответ различает четыре вида отказа, по ним редактор решает, что показать:
 *   · conflict (P0001) — справочник изменили, правки остаются на экране;
 *   · forbidden (42501) — нет права;
 *   · invalid (22023) — форма записи, текст сервера дословно (веха 5б);
 *   · other — сеть и прочее.
 * Каждая ошибка Supabase — `toast.error` (правило проекта).
 */
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('catalogAdmin', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('putCatalog зовёт catalog_put с таблицей, ключом, значением и базой', async () => {
    rpc.mockResolvedValueOnce({ data: '2026-10-17T10:00:00Z', error: null });
    const clear = vi.spyOn(catalogs, 'clearCatalogsCache');
    const res = await putCatalog('app_config', 'tzSettings', { footerText: 'Б' }, { footerText: 'А' });
    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('catalog_put', {
      p_table: 'app_config', p_key: 'tzSettings', p_value: { footerText: 'Б' }, p_base: { footerText: 'А' },
    });
    expect(clear).toHaveBeenCalled();
  });

  it('putCatalog: база undefined уходит как null (строки ещё нет)', async () => {
    rpc.mockResolvedValueOnce({ data: '2026-10-17T10:00:00Z', error: null });
    await putCatalog('catalog_config', 'suppliers', [], undefined);
    expect(rpc).toHaveBeenCalledWith('catalog_put', expect.objectContaining({ p_base: null }));
  });

  it('P0001 — conflict с текстом сервера, кэш каталогов сброшен, тост', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    const clear = vi.spyOn(catalogs, 'clearCatalogsCache');
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: CONFLICT_MESSAGE } });
    const res = await putCatalog('app_config', 'labelLibrary', { kinds: [], schemes: [] }, { kinds: [], schemes: [] });
    expect(res).toEqual({ ok: false, kind: 'conflict', message: CONFLICT_MESSAGE });
    expect(clear).toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(CONFLICT_MESSAGE);
  });

  it('42501 — forbidden с текстом сервера', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    const msg = 'Справочники меняет администратор, директор или руководитель продаж';
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: msg } });
    const res = await putCatalog('app_config', 'tzSettings', { footerText: '' }, null);
    expect(res).toEqual({ ok: false, kind: 'forbidden', message: msg });
    expect(err).toHaveBeenCalledWith(msg);
  });

  it('22023 — invalid с текстом сервера дословно (форма записи, веха 5б)', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    const clear = vi.spyOn(catalogs, 'clearCatalogsCache');
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'Код цвета повторяется: 5001' } });
    const res = await putCatalog('catalog_config', 'suppliers', [], []);
    expect(res).toEqual({ ok: false, kind: 'invalid', message: 'Код цвета повторяется: 5001' });
    expect(err).toHaveBeenCalledWith('Код цвета повторяется: 5001');
    // Форма — не конфликт: кэш не сбрасывается
    expect(clear).not.toHaveBeenCalled();
  });

  it('прочий код ошибки — other', async () => {
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const res = await putCatalog('app_config', 'tzSettings', { footerText: '' }, null);
    expect(res).toMatchObject({ ok: false, kind: 'other' });
  });

  it('отказ сети — other, тост, без исключения', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const res = await putCatalog('app_config', 'tzSettings', { footerText: '' }, null);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind).toBe('other');
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('patchPrices зовёт prices_patch; undefined в базе — null (ключа ещё нет)', async () => {
    rpc.mockResolvedValueOnce({ data: { updated_at: '2026-10-17T10:00:00Z' }, error: null });
    const res = await patchPrices({ minMarginPct: 15 }, { minMarginPct: undefined });
    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('prices_patch', { p_patch: { minMarginPct: 15 }, p_base: { minMarginPct: null } });
  });

  it('patchPrices: P0001 — conflict, 42501 — forbidden', async () => {
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: CONFLICT_MESSAGE } });
    expect(await patchPrices({ label: 31 }, { label: 30 })).toMatchObject({ ok: false, kind: 'conflict' });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Руководитель продаж меняет только упаковку, подготовку и порог маржи' } });
    expect(await patchPrices({ label: 31 }, { label: 30 })).toMatchObject({ ok: false, kind: 'forbidden' });
  });

  it('ошибка без текста — запасной русский текст', async () => {
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: '' } });
    expect(await patchPrices({ prepFees: {} }, { prepFees: {} })).toEqual({ ok: false, kind: 'conflict', message: CONFLICT_MESSAGE });
  });
});
