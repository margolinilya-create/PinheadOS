import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import {
  FLATS_BUCKET, FLAT_MAX_BYTES, FLAT_MIME, FLAT_VIEW_KINDS,
  downloadFlatSvg, flatSvgPath, isFlatPath, uploadFlatSvg,
} from './garmentFlats';

/**
 * Флэты изделий — закрытый бакет `garment-flats` (веха 5а, миграция H).
 * Путь `flats/<id>/v<N>/<вид>.svg` — та же форма, что `garment_flat_path_ok`
 * в базе; объект неизменяем (`upsert: false`, «уже есть» — успех: путь
 * версионный, содержимое то же); ошибка — toast.error и null.
 */
const storageFrom = supabase.storage.from as unknown as ReturnType<typeof vi.fn>;

function mockBucket(overrides: Record<string, unknown> = {}) {
  const bucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(['<svg/>'], { type: FLAT_MIME }), error: null }),
    ...overrides,
  };
  storageFrom.mockReturnValue(bucket);
  return bucket;
}

const toastError = vi.spyOn(toast, 'error').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('garmentFlats: константы и путь', () => {
  it('бакет, тип и лимит', () => {
    expect(FLATS_BUCKET).toBe('garment-flats');
    expect(FLAT_MIME).toBe('image/svg+xml');
    expect(FLAT_MAX_BYTES).toBe(1048576);
    expect([...FLAT_VIEW_KINDS]).toEqual(['front', 'back', 'sleeve_left', 'sleeve_right']);
  });

  it('flatSvgPath строит версионный путь', () => {
    expect(flatSvgPath('tshirt-freefit', 1, 'front')).toBe('flats/tshirt-freefit/v1/front.svg');
    expect(flatSvgPath('hoodie-reglan', 12, 'sleeve_left')).toBe('flats/hoodie-reglan/v12/sleeve_left.svg');
  });

  it.each([
    ['flats/tshirt-freefit/v1/front.svg', true],
    ['flats/a/v9999/back.svg', true],
    ['flats/a/v10000/back.svg', false],
    ['flats/a/v0/front.svg', false],
    ['flats/a/front.svg', false],
    ['flats/футболка/v1/front.svg', false],
    ['flats/../v1/front.svg', false],
    ['flats/a/v1/front.png', false],
    ['flats/Tee/v1/front.svg', false],
    ['flats/a/v1/front.svg\n', false],
    ['flats/a/v1/sleeve.svg', false],
    ['x/flats/a/v1/front.svg', false],
    ['', false],
  ])('isFlatPath(%j) = %s', (p, ok) => {
    expect(isFlatPath(p)).toBe(ok);
  });

  it('isFlatPath не падает на не-строке', () => {
    expect(isFlatPath(null)).toBe(false);
    expect(isFlatPath(42)).toBe(false);
  });

  it('flatSvgPath с неверным id или версией — пустая строка (не путь)', () => {
    expect(flatSvgPath('Футболка', 1, 'front')).toBe('');
    expect(flatSvgPath('tee', 0, 'front')).toBe('');
    expect(flatSvgPath('tee', 1.5, 'front')).toBe('');
    expect(flatSvgPath('tee', 1, 'side' as never)).toBe('');
  });
});

describe('uploadFlatSvg', () => {
  const PATH = 'flats/tee/v1/front.svg';

  it('грузит SVG с upsert: false и типом image/svg+xml', async () => {
    const b = mockBucket();
    await expect(uploadFlatSvg(PATH, '<svg xmlns="http://www.w3.org/2000/svg"/>')).resolves.toBe('uploaded');
    expect(storageFrom).toHaveBeenCalledWith('garment-flats');
    const [path, body, opts] = b.upload.mock.calls[0];
    expect(path).toBe(PATH);
    expect((body as Blob).type).toBe('image/svg+xml');
    expect(opts).toEqual({ upsert: false, contentType: 'image/svg+xml' });
  });

  it('«уже есть» — успех exists без тоста', async () => {
    mockBucket({ upload: vi.fn().mockResolvedValue({ data: null, error: { message: 'The resource already exists', statusCode: '409' } }) });
    await expect(uploadFlatSvg(PATH, '<svg/>')).resolves.toBe('exists');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('Duplicate по тексту ошибки — тоже exists', async () => {
    mockBucket({ upload: vi.fn().mockResolvedValue({ data: null, error: { message: 'Duplicate' } }) });
    await expect(uploadFlatSvg(PATH, '<svg/>')).resolves.toBe('exists');
  });

  it('прочая ошибка — toast и null', async () => {
    mockBucket({ upload: vi.fn().mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy' } }) });
    await expect(uploadFlatSvg(PATH, '<svg/>')).resolves.toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('сеть упала — toast и null', async () => {
    mockBucket({ upload: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    await expect(uploadFlatSvg(PATH, '<svg/>')).resolves.toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('неверный путь и пустой или большой файл — в бакет не идёт', async () => {
    const b = mockBucket();
    await expect(uploadFlatSvg('flats/tee/front.svg', '<svg/>')).resolves.toBeNull();
    await expect(uploadFlatSvg(PATH, '')).resolves.toBeNull();
    await expect(uploadFlatSvg(PATH, 'я'.repeat(FLAT_MAX_BYTES / 2 + 1))).resolves.toBeNull();
    expect(b.upload).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(3);
  });
});

describe('downloadFlatSvg', () => {
  const PATH = 'flats/tee/v1/back.svg';

  it('отдаёт текст SVG', async () => {
    const b = mockBucket();
    await expect(downloadFlatSvg(PATH)).resolves.toBe('<svg/>');
    expect(b.download).toHaveBeenCalledWith(PATH);
  });

  it('путь не флэта (справочник правили мимо RPC) — не скачивает', async () => {
    const b = mockBucket();
    await expect(downloadFlatSvg('orders/x/logo.svg')).resolves.toBeNull();
    await expect(downloadFlatSvg('flats/../../x.svg')).resolves.toBeNull();
    expect(b.download).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(2);
  });

  it('ошибка Storage — toast и null', async () => {
    mockBucket({ download: vi.fn().mockResolvedValue({ data: null, error: { message: 'Object not found' } }) });
    await expect(downloadFlatSvg(PATH)).resolves.toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('больше лимита бакета — null', async () => {
    const big = { size: FLAT_MAX_BYTES + 1, text: vi.fn() } as unknown as Blob;
    mockBucket({ download: vi.fn().mockResolvedValue({ data: big, error: null }) });
    await expect(downloadFlatSvg(PATH)).resolves.toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('сеть упала — toast и null', async () => {
    mockBucket({ download: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    await expect(downloadFlatSvg(PATH)).resolves.toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
