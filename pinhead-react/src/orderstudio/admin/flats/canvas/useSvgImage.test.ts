import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSvgImage } from './useSvgImage';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="garment" fill="#000000"><rect width="10" height="10"/></g></svg>';
const SVG2 = SVG.replace('width="10" height="10"/>', 'width="5" height="5"/>');

/** Картинка jsdom не декодирует: подмена — `onload` (или `onerror` для «битых») на следующем такте */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static fail = false;
  set src(_: string) {
    setTimeout(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()), 0);
  }
}

let blobs: Blob[];
let created: string[];
let revoked: string[];

beforeEach(() => {
  FakeImage.fail = false;
  blobs = [];
  created = [];
  revoked = [];
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blobs.push(b as Blob);
    const url = `blob:test/${created.length}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useSvgImage', () => {
  it('нет разметки — none, без object URL', () => {
    const { result } = renderHook(() => useSvgImage(null, '#d9d9d9'));
    expect(result.current).toEqual({ status: 'none', image: null });
    expect(created).toEqual([]);
  });

  it('декодирует: loading → ready; силуэт перекрашен в цвет холста', async () => {
    const { result } = renderHook(() => useSvgImage(SVG, '#d9d9d9'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.image).toBeInstanceOf(FakeImage);
    expect(blobs[0].type).toBe('image/svg+xml');
    expect(await blobs[0].text()).toContain('fill="#d9d9d9"');
  });

  it('освобождает object URL при смене разметки и при уходе', async () => {
    const { result, rerender, unmount } = renderHook(({ m }) => useSvgImage(m, '#d9d9d9'), { initialProps: { m: SVG } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ m: SVG2 });
    expect(revoked).toEqual(['blob:test/0']);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    unmount();
    expect(revoked).toEqual(['blob:test/0', 'blob:test/1']);
  });

  it('разметка не прошла санитайзер — error без object URL', () => {
    const { result } = renderHook(() => useSvgImage('<html>not svg</html>', '#d9d9d9'));
    expect(result.current.status).toBe('error');
    expect(created).toEqual([]);
  });

  it('скрипт из разметки до картинки не доходит (повторная очистка)', async () => {
    const evil = SVG.replace('</svg>', '<script>alert(1)</script></svg>').replace('<svg ', '<svg onload="alert(2)" ');
    renderHook(() => useSvgImage(evil, '#d9d9d9'));
    await act(async () => { await Promise.resolve(); });
    const text = await blobs[0].text();
    expect(text).not.toMatch(/<script|onload/i);
  });

  it('картинка не открылась — error', async () => {
    FakeImage.fail = true;
    const { result } = renderHook(() => useSvgImage(SVG, '#d9d9d9'));
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
