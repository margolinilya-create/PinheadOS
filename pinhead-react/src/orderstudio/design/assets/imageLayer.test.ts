import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetUpdatePrompt } from '../../../lib/appUpdate';
import { useConfirmStore } from '../../../store/useConfirmStore';
import { useToastStore } from '../../../store/useToastStore';
import { lazyModule, MSG_IMAGES_UNAVAILABLE } from './imageLayer';

/**
 * Кэши картинок холста по требованию (ревью 6б, раунд 1): одна загрузка на
 * попытку, сбой — `null` и один тост (или «Вышло обновление»), повтор после сбоя,
 * освобождение — только у загруженного модуля.
 */
const toasts = () => useToastStore.getState().toasts.filter((t) => t.type === 'error').map((t) => t.message);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ open: false, title: '' });
  resetUpdatePrompt();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('lazyModule', () => {
  it('одна загрузка на два одновременных запроса; потом — из памяти', async () => {
    const mod = { release: vi.fn() };
    const load = vi.fn(() => Promise.resolve(mod));
    const m = lazyModule('t', load);
    expect(m.loaded()).toBeNull();
    const [a, b] = await Promise.all([m.get(), m.get()]);
    expect(a).toBe(mod);
    expect(b).toBe(mod);
    expect(await m.get()).toBe(mod);
    expect(load).toHaveBeenCalledTimes(1);
    expect(m.loaded()).toBe(mod);
  });

  it('сбой сети — null и один тост на попытку; следующая попытка грузит снова', async () => {
    const mod = {};
    const load = vi.fn().mockRejectedValueOnce(new TypeError('network down')).mockResolvedValueOnce(mod);
    const m = lazyModule('t', load);
    const [a, b] = await Promise.all([m.get(), m.get()]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(toasts()).toEqual([MSG_IMAGES_UNAVAILABLE]);
    expect(m.loaded()).toBeNull();
    expect(await m.get()).toBe(mod);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('чанк пропал после выкладки — общий диалог «Вышло обновление», без тоста', async () => {
    const m = lazyModule('t', () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/flatImages-1.js')));
    expect(await m.get()).toBeNull();
    expect(useConfirmStore.getState().open).toBe(true);
    expect(toasts()).toEqual([]);
  });
});

describe('releaseFlatImages / releaseArtworkImages', () => {
  it('кэш не загружен — освобождать нечего, чанк не качается; загружен — освобождает', async () => {
    vi.resetModules();
    const flats = vi.hoisted(() => ({ releaseFlatImages: vi.fn(), loaded: vi.fn() }));
    vi.doMock('./flatImages', () => {
      flats.loaded();
      return { releaseFlatImages: flats.releaseFlatImages };
    });
    const layer = await import('./imageLayer');
    layer.releaseFlatImages();
    expect(flats.loaded).not.toHaveBeenCalled();
    expect(flats.releaseFlatImages).not.toHaveBeenCalled();
    await layer.flatImagesModule.get();
    layer.releaseFlatImages();
    expect(flats.releaseFlatImages).toHaveBeenCalledTimes(1);
    vi.doUnmock('./flatImages');
  });
});
