import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pngBytes, textBytes } from './bytes.testutil';
import { MAX_DISPLAY_PX, loadArtworkImage, primeArtworkImage, releaseArtworkImages } from './artworkImages';

const api = vi.hoisted(() => ({ downloadArtwork: vi.fn() }));
vi.mock('../../api/artworks', async (orig) => ({ ...(await orig<typeof import('../../api/artworks')>()), ...api }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../../store/useToastStore', () => ({ toast }));

const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const base = `orders/${ORDER}/logo/1b2c3d4e-0000-4000-8000-000000000000`;

/** Картинка без сети: грузится на следующем такте; `blob:bad…` — ошибка декодирования */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private s = '';
  set src(v: string) {
    this.s = v;
    queueMicrotask(() => (v.startsWith('blob:bad') ? this.onerror?.() : this.onload?.()));
  }
  get src() { return this.s; }
}

let urls: Blob[] = [];
const created = vi.fn((b: Blob | MediaSource) => {
  urls.push(b as Blob);
  return `blob:${urls.length}`;
});
const revoked = vi.fn();

const respond = (bytes: Uint8Array, type = 'text/html') => api.downloadArtwork.mockResolvedValueOnce(new Blob([bytes as BlobPart], { type }));

beforeEach(() => {
  releaseArtworkImages();
  urls = [];
  created.mockClear();
  revoked.mockClear();
  api.downloadArtwork.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(created);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoked);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadArtworkImage — тип по байтам, чистый Blob (H2)', () => {
  it('SVG со скриптом: в картинку уходит очищенный текст, тип — svg', async () => {
    respond(textBytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="1" height="1"/></svg>'));
    const img = await loadArtworkImage(ORDER, `${base}-logo.svg`, false);
    expect(img).toBeInstanceOf(FakeImage);
    expect(api.downloadArtwork).toHaveBeenCalledWith(ORDER, `${base}-logo.svg`);
    expect(urls).toHaveLength(1);
    expect(urls[0].type).toBe('image/svg+xml');
    const text = await urls[0].text();
    expect(text).not.toMatch(/<script|onload/i);
    expect(text).toContain('<rect');
  });

  it('растр: тип по сигнатуре, а не по ответу', async () => {
    respond(pngBytes(10, 10), 'text/html');
    await loadArtworkImage(ORDER, `${base}-logo.png`, false);
    expect(urls[0].type).toBe('image/png');
  });

  it('содержимое не совпадает с расширением — отказ, тост, без object URL', async () => {
    respond(pngBytes(10, 10));
    expect(await loadArtworkImage(ORDER, `${base}-logo.svg`, false)).toBeNull();
    expect(created).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('бомба по заголовку (20 000 px) — отказ при скачивании (M2)', async () => {
    respond(pngBytes(20000, 100));
    expect(await loadArtworkImage(ORDER, `${base}-logo.png`, false)).toBeNull();
    expect(created).not.toHaveBeenCalled();
    expect(toast.error.mock.calls[0][0]).toMatch(/слишком большая/);
  });

  it('PDF/AI: рисуется превью рядом с исходником, и только PNG', async () => {
    respond(pngBytes(10, 10));
    expect(await loadArtworkImage(ORDER, `${base}-logo.pdf`, true)).toBeInstanceOf(FakeImage);
    expect(api.downloadArtwork).toHaveBeenCalledWith(ORDER, `${base}-logo.pdf.preview.png`);
    respond(textBytes('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(await loadArtworkImage(ORDER, `${base}-other.pdf`, true)).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('PDF без превью не рисуется', async () => {
    respond(textBytes('%PDF-1.7\n'));
    expect(await loadArtworkImage(ORDER, `${base}-logo.pdf`, false)).toBeNull();
    expect(toast.error.mock.calls[0][0]).toMatch(/нет превью/);
  });

  it('сбой скачивания — null (тост даёт api), повтор не идёт в сеть', async () => {
    api.downloadArtwork.mockResolvedValue(null);
    expect(await loadArtworkImage(ORDER, `${base}-logo.png`, false)).toBeNull();
    expect(await loadArtworkImage(ORDER, `${base}-logo.png`, false)).toBeNull();
    expect(api.downloadArtwork).toHaveBeenCalledTimes(1);
  });

  it('битая картинка — тост один раз на путь', async () => {
    created.mockImplementationOnce(() => 'blob:bad-1');
    respond(pngBytes(10, 10));
    expect(await loadArtworkImage(ORDER, `${base}-logo.png`, false)).toBeNull();
    expect(await loadArtworkImage(ORDER, `${base}-logo.png`, false)).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('пустые входы — null без запроса', async () => {
    expect(await loadArtworkImage('', `${base}-logo.png`, false)).toBeNull();
    expect(await loadArtworkImage(ORDER, '', false)).toBeNull();
    expect(api.downloadArtwork).not.toHaveBeenCalled();
  });
});

describe('кэш и object URL (L8)', () => {
  it('один запрос на путь', async () => {
    respond(pngBytes(10, 10));
    const [a, b] = await Promise.all([
      loadArtworkImage(ORDER, `${base}-logo.png`, false),
      loadArtworkImage(ORDER, `${base}-logo.png`, false),
    ]);
    expect(a).toBe(b);
    expect(api.downloadArtwork).toHaveBeenCalledTimes(1);
  });

  it('release освобождает все URL, следующий показ скачивает заново', async () => {
    respond(pngBytes(10, 10));
    respond(pngBytes(10, 10));
    await loadArtworkImage(ORDER, `${base}-a.png`, false);
    await loadArtworkImage(ORDER, `${base}-b.png`, false);
    releaseArtworkImages();
    expect(revoked.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:1', 'blob:2']);
    respond(pngBytes(10, 10));
    await loadArtworkImage(ORDER, `${base}-a.png`, false);
    expect(api.downloadArtwork).toHaveBeenCalledTimes(3);
  });

  it('prime кладёт чистый Blob без скачивания; замена по пути освобождает прежний URL', async () => {
    const blob = new Blob([pngBytes(10, 10) as BlobPart], { type: 'image/png' });
    expect(await primeArtworkImage(`${base}-logo.png`, false, blob)).toBeInstanceOf(FakeImage);
    expect(await loadArtworkImage(ORDER, `${base}-logo.png`, false)).toBeInstanceOf(FakeImage);
    expect(api.downloadArtwork).not.toHaveBeenCalled();
    await primeArtworkImage(`${base}-logo.png`, false, blob);
    expect(revoked).toHaveBeenCalledWith('blob:1');
  });

  it('сброс во время скачивания — URL не утекает', async () => {
    let release!: (b: Blob) => void;
    api.downloadArtwork.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const pending = loadArtworkImage(ORDER, `${base}-logo.png`, false);
    releaseArtworkImages();
    release(new Blob([pngBytes(10, 10) as BlobPart]));
    expect(await pending).toBeNull();
    expect(created).not.toHaveBeenCalled();
  });
});

describe('большой растр уменьшается для показа', () => {
  it(`сторона больше ${MAX_DISPLAY_PX} px — createImageBitmap с уменьшением, в картинку — PNG`, async () => {
    const close = vi.fn();
    const bitmap = vi.fn(async (_b: Blob, o: { resizeWidth: number; resizeHeight: number }) => ({ width: o.resizeWidth, height: o.resizeHeight, close }));
    vi.stubGlobal('createImageBitmap', bitmap);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['small'], { type: 'image/png' }));
    });
    respond(pngBytes(8192, 1024));
    await loadArtworkImage(ORDER, `${base}-big.png`, false);
    expect(bitmap.mock.calls[0][1]).toMatchObject({ resizeWidth: 4096, resizeHeight: 512 });
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(await urls[0].text()).toBe('small');
  });

  it('небольшой растр не трогается', async () => {
    const bitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', bitmap);
    respond(pngBytes(4096, 10));
    await loadArtworkImage(ORDER, `${base}-ok.png`, false);
    expect(bitmap).not.toHaveBeenCalled();
  });
});
