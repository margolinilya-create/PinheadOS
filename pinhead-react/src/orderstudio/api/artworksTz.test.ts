import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { TZ_PDF_MAX_BYTES, uploadTzPdf } from './artworks';

/**
 * PDF ТЗ группы в `order-artworks` (веха 6+7, К1): путь `orders/<id>/tz/<uuid>-<имя>`
 * (тот, что проверяют `order_artwork_path_ok` и миграция J при отправке),
 * тип `application/pdf`, `upsert: false` — новая версия = новый ключ.
 */
const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const storageFrom = supabase.storage.from as unknown as ReturnType<typeof vi.fn>;

const pdf = (size?: number) => {
  const b = new Blob(['%PDF-1.7\n…'], { type: '' });
  if (size !== undefined) Object.defineProperty(b, 'size', { value: size });
  return b;
};

function mockBucket(upload = vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null })) {
  storageFrom.mockReturnValue({ upload });
  return upload;
}

describe('uploadTzPdf', () => {
  beforeEach(() => {
    storageFrom.mockReset();
    vi.restoreAllMocks();
  });

  it('путь orders/<id>/tz/…, application/pdf, upsert: false; хэши в начале имени сохранены', async () => {
    const upload = mockBucket();
    const name = 'PH-0042-g1a2b3c4d-c0123456789ab-Futbolka.pdf';
    const p = await uploadTzPdf(ORDER, pdf(), name);
    expect(p).toMatch(new RegExp(`^orders/${ORDER}/tz/[0-9a-f-]{36}-PH-0042-g1a2b3c4d-c0123456789ab-Futbolka\\.pdf$`));
    expect(storageFrom).toHaveBeenCalledWith('order-artworks');
    const [path, body, opts] = upload.mock.calls[0];
    expect(path).toBe(p);
    expect((body as Blob).type).toBe('application/pdf');
    expect(opts).toEqual({ upsert: false, contentType: 'application/pdf' });
  });

  it('не PDF по сигнатуре — отказ без запроса', async () => {
    const upload = mockBucket();
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await uploadTzPdf(ORDER, new Blob(['<svg/>']), 'x.pdf')).toBeNull();
    expect(upload).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('больше 8 МБ (порог сервера при отправке) — отказ без запроса', async () => {
    const upload = mockBucket();
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(TZ_PDF_MAX_BYTES).toBe(8388608);
    expect(await uploadTzPdf(ORDER, pdf(TZ_PDF_MAX_BYTES + 1), 'x.pdf')).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('неверный заказ — отказ без запроса', async () => {
    const upload = mockBucket();
    vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await uploadTzPdf('not-uuid', pdf(), 'x.pdf')).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('ошибка Storage — тост и null', async () => {
    mockBucket(vi.fn().mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy' } }));
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await uploadTzPdf(ORDER, pdf(), 'x.pdf')).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });
});
