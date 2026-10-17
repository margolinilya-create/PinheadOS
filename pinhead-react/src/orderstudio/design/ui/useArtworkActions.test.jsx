import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToastStore } from '../../../store/useToastStore';
import { artworkPipeline, MSG_UPLOAD_UNAVAILABLE, useArtworkActions } from './useArtworkActions';

const TARGET = { orderId: 'o', itemKey: 'k' };
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

afterEach(() => {
  vi.restoreAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe('useArtworkActions — конвейер логотипа по действию', () => {
  it('монтаж ничего не грузит; действие грузит конвейер и отдаёт ключ', async () => {
    const addArtworkFile = vi.fn().mockResolvedValue('p-1');
    const load = vi.spyOn(artworkPipeline, 'load').mockResolvedValue({ addArtworkFile, addExistingArtwork: vi.fn() });
    const { result } = renderHook(() => useArtworkActions(TARGET));
    expect(load).not.toHaveBeenCalled();
    const file = new File(['x'], 'logo.png');
    let key;
    await act(async () => { key = await result.current.addFile(file, { areaId: 'chest' }); });
    expect(key).toBe('p-1');
    expect(addArtworkFile).toHaveBeenCalledWith(file, TARGET, { areaId: 'chest' });
    expect(result.current.busy).toBe(false);
  });

  it('без цели (только чтение, нет флэта) — ничего не делает', async () => {
    const load = vi.spyOn(artworkPipeline, 'load');
    const { result } = renderHook(() => useArtworkActions(null));
    let key;
    await act(async () => { key = await result.current.addFile(new File(['x'], 'a.png')); });
    expect(key).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('чанк не загрузился — тост, нанесения нет, не висит «Загружаю»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(artworkPipeline, 'load').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useArtworkActions(TARGET));
    let key;
    await act(async () => { key = await result.current.addExisting({ path: 'p', asset: {} }); });
    expect(key).toBeNull();
    expect(toasts()).toContain(MSG_UPLOAD_UNAVAILABLE);
    expect(result.current.busy).toBe(false);
  });
});
