import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import {
  ARTWORK_MAX_BYTES, PREVIEW_SUFFIX, artworkPreviewPath, downloadArtwork, isArtworkPath, isPreviewPath,
  uploadArtworkPreview,
} from './artworks';
import { pngBytes } from '../design/assets/bytes.testutil';

/**
 * Превью PDF/AI и чтение файлов заказа для холста (веха 5а, решение 3;
 * проверка безопасности M3, H2): путь превью выводится из исходника, в бакет
 * идёт только PNG по сигнатуре без upsert; холст читает только `download()`
 * по пути своего заказа.
 */
const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const SRC = `orders/${ORDER}/logo/1b2c3d4e-0000-4000-8000-000000000000-logo.pdf`;

const storageFrom = supabase.storage.from as unknown as ReturnType<typeof vi.fn>;

function mockBucket(overrides: Record<string, unknown> = {}) {
  const bucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(['x']), error: null }),
    ...overrides,
  };
  storageFrom.mockReturnValue(bucket);
  return bucket;
}

const png = () => new Blob([pngBytes(10, 10) as BlobPart], { type: 'image/png' });

beforeEach(() => {
  storageFrom.mockReset();
  vi.restoreAllMocks();
});

describe('путь превью', () => {
  it('= исходник + .preview.png и проходит проверку пути заказа', () => {
    expect(PREVIEW_SUFFIX).toBe('.preview.png');
    expect(artworkPreviewPath(SRC)).toBe(`${SRC}.preview.png`);
    expect(isArtworkPath(ORDER, artworkPreviewPath(SRC))).toBe(true);
    expect(isPreviewPath(artworkPreviewPath(SRC))).toBe(true);
  });

  it('у превью и пустого пути превью нет', () => {
    expect(artworkPreviewPath(`${SRC}.preview.png`)).toBe('');
    expect(artworkPreviewPath('')).toBe('');
  });
});

describe('uploadArtworkPreview', () => {
  it('кладёт PNG по выводимому пути: image/png, без upsert', async () => {
    const b = mockBucket();
    expect(await uploadArtworkPreview(ORDER, SRC, png())).toBe(`${SRC}.preview.png`);
    expect(storageFrom).toHaveBeenCalledWith('order-artworks');
    const [path, body, opts] = b.upload.mock.calls[0];
    expect(path).toBe(`${SRC}.preview.png`);
    expect((body as Blob).type).toBe('image/png');
    expect(opts).toEqual({ upsert: false, contentType: 'image/png' });
  });

  it.each([
    ['исходник чужого заказа', 'orders/11111111-1111-4111-8111-111111111111/logo/a.pdf'],
    ['исходник — уже превью', `${SRC}.preview.png`],
    ['пустой исходник', ''],
    ['«..» в пути', `orders/${ORDER}/../a.pdf`],
  ])('%s — отказ без запроса', async (_, source) => {
    const b = mockBucket();
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await uploadArtworkPreview(ORDER, source, png())).toBeNull();
    expect(b.upload).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('не PNG по байтам (тип Blob не в счёт) — отказ', async () => {
    const b = mockBucket();
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    const fake = new Blob(['<svg onload="alert(1)"/>'], { type: 'image/png' });
    expect(await uploadArtworkPreview(ORDER, SRC, fake)).toBeNull();
    expect(b.upload).not.toHaveBeenCalled();
    expect(err.mock.calls[0][0]).toContain('не PNG');
  });

  it('пустой и больше 25 МБ — отказ', async () => {
    const b = mockBucket();
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await uploadArtworkPreview(ORDER, SRC, new Blob([]))).toBeNull();
    const big = png();
    Object.defineProperty(big, 'size', { value: ARTWORK_MAX_BYTES + 1 });
    expect(await uploadArtworkPreview(ORDER, SRC, big)).toBeNull();
    expect(b.upload).not.toHaveBeenCalled();
  });

  it('ошибка Storage и сети — тост и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockBucket({ upload: vi.fn().mockResolvedValue({ data: null, error: { message: 'The resource already exists' } }) });
    expect(await uploadArtworkPreview(ORDER, SRC, png())).toBeNull();
    mockBucket({ upload: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    expect(await uploadArtworkPreview(ORDER, SRC, png())).toBeNull();
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe('downloadArtwork', () => {
  it('отдаёт Blob файла своего заказа', async () => {
    const blob = png();
    const b = mockBucket({ download: vi.fn().mockResolvedValue({ data: blob, error: null }) });
    expect(await downloadArtwork(ORDER, SRC)).toBe(blob);
    expect(b.download).toHaveBeenCalledWith(SRC);
  });

  it('путь чужого заказа — отказ без запроса', async () => {
    const b = mockBucket();
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await downloadArtwork(ORDER, 'orders/11111111-1111-4111-8111-111111111111/logo/a.png')).toBeNull();
    expect(b.download).not.toHaveBeenCalled();
  });

  it('ошибка, пустой ответ, сеть, больше 25 МБ — тост и null', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockBucket({ download: vi.fn().mockResolvedValue({ data: null, error: { message: 'Object not found' } }) });
    expect(await downloadArtwork(ORDER, SRC)).toBeNull();
    mockBucket({ download: vi.fn().mockResolvedValue({ data: null, error: null }) });
    expect(await downloadArtwork(ORDER, SRC)).toBeNull();
    mockBucket({ download: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    expect(await downloadArtwork(ORDER, SRC)).toBeNull();
    const big = png();
    Object.defineProperty(big, 'size', { value: ARTWORK_MAX_BYTES + 1 });
    mockBucket({ download: vi.fn().mockResolvedValue({ data: big, error: null }) });
    expect(await downloadArtwork(ORDER, SRC)).toBeNull();
    expect(err).toHaveBeenCalledTimes(4);
  });
});
