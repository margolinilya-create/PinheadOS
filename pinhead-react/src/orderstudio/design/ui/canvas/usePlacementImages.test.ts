import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const loadArtworkImage = vi.fn();
vi.mock('../../assets/artworkImages', () => ({
  loadArtworkImage: (...args: unknown[]) => loadArtworkImage(...args),
}));

import { usePlacementImages, type ImageRef } from './usePlacementImages';

const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const A = `orders/${ORDER}/logo/a.png`;
const B = `orders/${ORDER}/logo/b.pdf`;

beforeEach(() => {
  loadArtworkImage.mockReset();
});

describe('usePlacementImages', () => {
  it('один файл на два нанесения грузится один раз; превью PDF — своим флагом', async () => {
    const img = document.createElement('img');
    loadArtworkImage.mockResolvedValue(img);
    const refs: ImageRef[] = [
      { key: 'p1', path: A, hasPreview: false },
      { key: 'p2', path: A, hasPreview: false },
      { key: 'p3', path: B, hasPreview: true },
    ];
    const { result } = renderHook(() => usePlacementImages(ORDER, refs));
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(loadArtworkImage).toHaveBeenCalledTimes(2);
    expect(loadArtworkImage).toHaveBeenCalledWith(ORDER, B, true);
    expect(result.current.images).toEqual({ p1: img, p2: img, p3: img });
  });

  it('не вышло (null) — тоже «решилось»: снимок не ждёт вечно', async () => {
    loadArtworkImage.mockResolvedValue(null);
    const { result } = renderHook(() => usePlacementImages(ORDER, [{ key: 'p1', path: A, hasPreview: false }]));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.images.p1).toBeNull();
  });

  it('нечего грузить — сразу решилось, запросов нет', () => {
    const { result } = renderHook(() => usePlacementImages(ORDER, []));
    expect(result.current.settled).toBe(true);
    expect(loadArtworkImage).not.toHaveBeenCalled();
  });

  it('повторный рендер с теми же нанесениями не запрашивает заново', async () => {
    loadArtworkImage.mockResolvedValue(null);
    const { result, rerender } = renderHook(({ refs }) => usePlacementImages(ORDER, refs), {
      initialProps: { refs: [{ key: 'p1', path: A, hasPreview: false }] },
    });
    await waitFor(() => expect(result.current.settled).toBe(true));
    rerender({ refs: [{ key: 'p1', path: A, hasPreview: false }] });
    expect(loadArtworkImage).toHaveBeenCalledTimes(1);
  });
});
