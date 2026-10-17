import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { flat } from '../fixtures.testutil';
import { useArtworkImage } from './useArtworkImage';
import { useFlatImage } from './useFlatImage';

const images = vi.hoisted(() => ({ loadArtworkImage: vi.fn() }));
vi.mock('./artworkImages', () => images);
const flats = vi.hoisted(() => ({ loadFlatImage: vi.fn() }));
vi.mock('./flatImages', () => flats);

const img = (n: number) => ({ n }) as unknown as HTMLImageElement;

beforeEach(() => {
  images.loadArtworkImage.mockReset();
  flats.loadFlatImage.mockReset();
});

describe('useArtworkImage', () => {
  it('грузит картинку пути заказа; без пути — null без запроса', async () => {
    images.loadArtworkImage.mockResolvedValue(img(1));
    const { result, rerender } = renderHook(({ path }) => useArtworkImage('o-1', path, true), { initialProps: { path: 'orders/o-1/logo/a.pdf' as string | null } });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(img(1)));
    expect(images.loadArtworkImage).toHaveBeenCalledWith('o-1', 'orders/o-1/logo/a.pdf', true);
    rerender({ path: null });
    expect(result.current).toBeNull();
    expect(images.loadArtworkImage).toHaveBeenCalledTimes(1);
  });

  it('смена пути — старая картинка не показывается, пока грузится новая; поздний ответ старого не ложится', async () => {
    let slow!: (v: HTMLImageElement) => void;
    images.loadArtworkImage.mockImplementationOnce(() => new Promise((r) => { slow = r; }));
    images.loadArtworkImage.mockResolvedValueOnce(img(2));
    const { result, rerender } = renderHook(({ path }) => useArtworkImage('o-1', path, false), { initialProps: { path: 'a.png' } });
    rerender({ path: 'b.png' });
    await waitFor(() => expect(result.current).toEqual(img(2)));
    slow(img(1));
    await Promise.resolve();
    expect(result.current).toEqual(img(2));
  });
});

describe('useFlatImage', () => {
  it('вид флэта в цвете: loading → ready с габаритом', async () => {
    flats.loadFlatImage.mockResolvedValue({ image: img(3), flatMm: { w: 600, h: 700 } });
    const f = flat();
    const { result } = renderHook(() => useFlatImage(f, 'front', '#112233'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', image: img(3), flatMm: { w: 600, h: 700 } });
    expect(flats.loadFlatImage).toHaveBeenCalledWith({ svg_path: f.views[0].svg_path, scale_mm_per_unit: 1 }, '#112233');
  });

  it('нет флэта или вида — none без запроса; сбой — error', async () => {
    const { result } = renderHook(() => useFlatImage(null, 'front', '#112233'));
    expect(result.current.status).toBe('none');
    const front = flat({ views: [flat().views[0]] });
    expect(renderHook(() => useFlatImage(front, 'back', '#112233')).result.current.status).toBe('none');
    expect(flats.loadFlatImage).not.toHaveBeenCalled();
    flats.loadFlatImage.mockResolvedValue(null);
    const failed = renderHook(() => useFlatImage(front, 'front', '#112233'));
    await waitFor(() => expect(failed.result.current.status).toBe('error'));
  });
});
