import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import {
  ERP_ATTACHMENTS_BUCKET, ERP_DUPLICATE_REASON, ERP_FILE_MAX_BYTES, ERP_FILE_TYPES, isErpFileKey, uploadErpFile,
} from './erpFiles';
import type { ErpFileType } from './erpFiles';

/**
 * Писатель `erp-attachments` из Order (К12): ключи попытки без id заказа,
 * тип только из белого списка и не из `blob.type`, 20 МБ до запроса,
 * 409 — отказ, а не успех.
 */
const storageFrom = supabase.storage.from as unknown as ReturnType<typeof vi.fn>;
const ATTEMPT = '1f0e2d3c-4b5a-4968-8776-655443322110';
const TZ_KEY = `tz/v4-${ATTEMPT}/9a8b7c6d-5e4f-4a3b-9c2d-1e0f2a3b4c5d/v1-tz.pdf`;
const ATT_KEY = `att/v4-${ATTEMPT}/print/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png`;

const blob = (size?: number, type = '') => {
  const b = new Blob(['%PDF-1.7'], { type });
  if (size !== undefined) Object.defineProperty(b, 'size', { value: size });
  return b;
};

function mockUpload(answer: unknown = { data: { path: 'x' }, error: null }) {
  const upload = vi.fn().mockResolvedValue(answer);
  storageFrom.mockReturnValue({ upload });
  return upload;
}

describe('ключи erp-attachments', () => {
  it.each([
    [TZ_KEY, true],
    [ATT_KEY, true],
    [`att/v4-${ATTEMPT}/label/x.jpg`, true],
    [`tz/v4-${ATTEMPT}`, false],
    [`tz/v4-not-a-uuid/g/v1-tz.pdf`, false],
    [`orders/${ATTEMPT}/tz/x.pdf`, false],
    [`tz/${ATTEMPT}/g/x.pdf`, false],
    [`tz/v4-${ATTEMPT}/../x.pdf`, false],
    [`tz/v4-${ATTEMPT}/g/ТЗ.pdf`, false],
    [`tz/v4-${ATTEMPT}//x.pdf`, false],
    [`att/v4-${ATTEMPT}/print/a b.png`, false],
    ['', false],
  ])('%s → %s', (key, ok) => {
    expect(isErpFileKey(key)).toBe(ok);
  });
});

describe('uploadErpFile', () => {
  beforeEach(() => {
    storageFrom.mockReset();
    vi.restoreAllMocks();
  });

  it('грузит в erp-attachments без upsert, тип — назначенный, а не тип Blob', async () => {
    const upload = mockUpload();
    // Blob объявлен SVG, вызывающий по сигнатуре назначил PDF — уходит PDF
    const r = await uploadErpFile(TZ_KEY, blob(undefined, 'image/svg+xml'), 'application/pdf');
    expect(r).toEqual({ ok: true, path: TZ_KEY, size: 8 });
    expect(storageFrom).toHaveBeenCalledWith(ERP_ATTACHMENTS_BUCKET);
    const [path, body, opts] = upload.mock.calls[0];
    expect(path).toBe(TZ_KEY);
    expect((body as Blob).type).toBe('application/pdf');
    expect(opts).toEqual({ upsert: false, contentType: 'application/pdf' });
  });

  it('21 МБ — отказ без запроса', async () => {
    const upload = mockUpload();
    const r = await uploadErpFile(TZ_KEY, blob(21 * 1024 * 1024), 'application/pdf');
    expect(r.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(ERP_FILE_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it('путь с .. или кириллицей — отказ без запроса', async () => {
    const upload = mockUpload();
    expect((await uploadErpFile(`tz/v4-${ATTEMPT}/../evil.pdf`, blob(), 'application/pdf')).ok).toBe(false);
    expect((await uploadErpFile(`tz/v4-${ATTEMPT}/g/ТЗ.pdf`, blob(), 'application/pdf')).ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('contentType вне белого списка — отказ без запроса', async () => {
    const upload = mockUpload();
    expect((await uploadErpFile(ATT_KEY, blob(), 'text/html' as ErpFileType)).ok).toBe(false);
    expect((await uploadErpFile(ATT_KEY, blob(), 'image/webp' as ErpFileType)).ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect([...ERP_FILE_TYPES].sort()).toEqual(
      ['application/pdf', 'application/postscript', 'image/jpeg', 'image/png', 'image/svg+xml'],
    );
  });

  it('409 Duplicate — НЕ успех: отказ с текстом про повтор, без тоста', async () => {
    mockUpload({ data: null, error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    const r = await uploadErpFile(TZ_KEY, blob(), 'application/pdf');
    expect(r).toEqual({ ok: false, reason: ERP_DUPLICATE_REASON });
    expect(ERP_DUPLICATE_REASON).toContain('уже есть в производстве');
    expect(err).not.toHaveBeenCalled();
  });

  it('409 только текстом (без statusCode) — тоже отказ', async () => {
    mockUpload({ data: null, error: { message: 'The resource already exists' } });
    expect(await uploadErpFile(TZ_KEY, blob(), 'application/pdf')).toEqual({ ok: false, reason: ERP_DUPLICATE_REASON });
  });

  it('иная ошибка — тост и ok:false', async () => {
    mockUpload({ data: null, error: { statusCode: '403', message: 'new row violates row-level security policy' } });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await uploadErpFile(TZ_KEY, blob(), 'application/pdf');
    expect(r.ok).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('отказ сети — тост и ok:false, без исключения', async () => {
    storageFrom.mockReturnValue({ upload: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await uploadErpFile(TZ_KEY, blob(), 'application/pdf')).ok).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('пустой файл — отказ без запроса', async () => {
    const upload = mockUpload();
    expect((await uploadErpFile(TZ_KEY, blob(0), 'application/pdf')).ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });
});
