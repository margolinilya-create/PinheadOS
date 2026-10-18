import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { newSalesOrder } from '../model/factory';
import { fixtureCatalogs } from '../fixtures/loadFixture.testutil';
import { MSG_CHECKLIST_FAILED, checklistModule, useSendChecklist } from './useSendChecklist';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../store/useToastStore', () => ({ toast }));

const catalogs = fixtureCatalogs();
const margin = { marginPct: null, minMarginPct: null };
const real = checklistModule.load;
afterEach(() => { checklistModule.load = real; vi.restoreAllMocks(); });

describe('useSendChecklist — модель чек-листа ленивым чанком', () => {
  it('черновик: после загрузки модуля — пункты чек-листа', async () => {
    const { result } = renderHook(() => useSendChecklist(newSalesOrder({ id: 'o-1' }), catalogs, margin));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.map((i) => i.id)).toEqual(['client', 'due', 'items']);
  });

  it('не черновик или нет справочников — null, модуль не грузится', () => {
    const load = vi.fn(real);
    checklistModule.load = load;
    const sent = renderHook(() => useSendChecklist(newSalesOrder({ id: 'o-1', status: 'ready_to_launch' }), catalogs, margin));
    expect(sent.result.current).toBeNull();
    expect(load).not.toHaveBeenCalled();
    const noCat = renderHook(() => useSendChecklist(newSalesOrder({ id: 'o-1' }), null, margin));
    expect(noCat.result.current).toBeNull();
  });

  it('чанк не загрузился — null без исключения (кнопка ждёт, ошибка в консоли)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    checklistModule.load = vi.fn(() => Promise.reject(new Error('chunk')));
    const { result } = renderHook(() => useSendChecklist(newSalesOrder({ id: 'o-1' }), catalogs, margin));
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(MSG_CHECKLIST_FAILED);
  });
});
