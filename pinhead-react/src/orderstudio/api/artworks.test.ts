import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import {
  ARTWORK_BUCKET, ARTWORK_MAX_BYTES, ARTWORK_MIME_TYPES, SIGNED_URL_TTL_SEC,
  artworkContentType, artworkPath, artworkSignedUrl, artworkSignedUrls, isArtworkPath,
  removeArtwork, uploadArtwork,
} from './artworks';

/**
 * Файлы заказа v4 в закрытом бакете `order-artworks` (миграция C,
 * 20261017070826_order_artworks_bucket). Ключ — строго ASCII
 * `orders/<id заказа>/<вид>/<uuid>-<имя>`; чтение — подписанной ссылкой
 * на 10 минут; ошибка — toast.error и null/false (правило проекта).
 */
const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
/** Та же проверка, что `order_artwork_path_ok` в базе */
const SERVER_RE = new RegExp(`^orders/${ORDER}/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`);

const storageFrom = supabase.storage.from as unknown as ReturnType<typeof vi.fn>;

function mockBucket(overrides: Record<string, unknown> = {}) {
  const bucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [{ name: 'x' }], error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://s/1?token=t' }, error: null }),
    createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  };
  storageFrom.mockReturnValue(bucket);
  return bucket;
}

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('artworks: путь', () => {
  it('константы бакета', () => {
    expect(ARTWORK_BUCKET).toBe('order-artworks');
    expect(ARTWORK_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(SIGNED_URL_TTL_SEC).toBe(600);
  });

  it.each([
    ['Логотип клиента.png'],
    ['my logo 🎉.svg'],
    ['../../../x.ai'],
    ['..'],
    [''],
    ['ТЗ (финал) №2.pdf'],
  ])('ключ для «%s» — ASCII, проходит регулярку базы, без «..»', (name) => {
    const p = artworkPath(ORDER, 'logo', name);
    expect(p).toMatch(SERVER_RE);
    expect(p).not.toContain('..');
    expect(p.startsWith(`orders/${ORDER}/logo/`)).toBe(true);
    expect(isArtworkPath(ORDER, p)).toBe(true);
  });

  it('имя: uuid-префикс и транслит', () => {
    const p = artworkPath(ORDER, 'flat', 'Логотип.png');
    expect(p).toMatch(new RegExp(`^orders/${ORDER}/flat/[0-9a-f-]{36}-Logotip\\.png$`));
    expect(artworkPath(ORDER, 'flat', 'Логотип.png')).not.toBe(p);
  });

  it('id заказа в верхнем регистре приводится к нижнему (база сравнивает нижний)', () => {
    expect(artworkPath(ORDER.toUpperCase(), 'tz', 'a.pdf')).toMatch(SERVER_RE);
  });

  it('isArtworkPath отвергает чужой заказ, «..», кириллицу и пустое', () => {
    expect(isArtworkPath(ORDER, `orders/${ORDER}/../x/a.png`)).toBe(false);
    expect(isArtworkPath(ORDER, 'orders/11111111-1111-4111-8111-111111111111/logo/a.png')).toBe(false);
    expect(isArtworkPath(ORDER, `orders/${ORDER}/logo/лого.png`)).toBe(false);
    expect(isArtworkPath(ORDER, `orders/${ORDER}/`)).toBe(false);
    expect(isArtworkPath(ORDER, '')).toBe(false);
  });
});

describe('artworks: тип файла', () => {
  it('список типов — ровно тот, что разрешён бакету', () => {
    expect([...ARTWORK_MIME_TYPES].sort()).toEqual([
      'application/illustrator', 'application/pdf', 'application/postscript',
      'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp',
    ]);
  });

  it('по расширению: .ai/.eps с пустым типом — application/postscript', () => {
    expect(artworkContentType(file('logo.ai', ''))).toBe('application/postscript');
    expect(artworkContentType(file('logo.EPS', ''))).toBe('application/postscript');
    expect(artworkContentType(file('a.JPG', ''))).toBe('image/jpeg');
    expect(artworkContentType(file('a.svg', ''))).toBe('image/svg+xml');
  });

  it('незнакомое расширение — тип браузера, только из списка', () => {
    expect(artworkContentType(file('noext', 'image/png'))).toBe('image/png');
    expect(artworkContentType(file('a.exe', 'application/octet-stream'))).toBeNull();
    expect(artworkContentType(file('a.cdr', ''))).toBeNull();
  });
});

describe('artworks: загрузка', () => {
  beforeEach(() => {
    storageFrom.mockReset();
    vi.restoreAllMocks();
  });

  it('грузит в order-artworks без upsert и возвращает путь', async () => {
    const b = mockBucket();
    const f = file('Логотип.png', 'image/png');
    const p = await uploadArtwork(ORDER, 'logo', f);
    expect(storageFrom).toHaveBeenCalledWith('order-artworks');
    expect(p).toMatch(SERVER_RE);
    const [path, body, opts] = b.upload.mock.calls[0];
    expect(path).toBe(p);
    expect(body).toBe(f);
    expect(opts).toMatchObject({ upsert: false, contentType: 'image/png' });
  });

  it('.ai с пустым типом уходит Blob-ом с типом application/postscript (иначе FormData даст octet-stream)', async () => {
    const b = mockBucket();
    await uploadArtwork(ORDER, 'logo', file('logo.ai', ''));
    const [, body, opts] = b.upload.mock.calls[0];
    expect((body as Blob).type).toBe('application/postscript');
    expect(opts.contentType).toBe('application/postscript');
  });

  it('файл больше 25 МБ не грузится: тост и null', async () => {
    const b = mockBucket();
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await uploadArtwork(ORDER, 'logo', file('a.png', 'image/png', ARTWORK_MAX_BYTES + 1))).toBeNull();
    expect(err).toHaveBeenCalledWith('Файл больше 25 МБ');
    expect(b.upload).not.toHaveBeenCalled();
  });

  it('ровно 25 МБ — грузится', async () => {
    const b = mockBucket();
    expect(await uploadArtwork(ORDER, 'logo', file('a.png', 'image/png', ARTWORK_MAX_BYTES))).not.toBeNull();
    expect(b.upload).toHaveBeenCalledTimes(1);
  });

  it('пустой файл и чужой формат не грузятся', async () => {
    const b = mockBucket();
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await uploadArtwork(ORDER, 'logo', file('a.png', 'image/png', 0))).toBeNull();
    expect(await uploadArtwork(ORDER, 'logo', file('a.exe', 'application/x-msdownload'))).toBeNull();
    expect(err).toHaveBeenCalledTimes(2);
    expect(b.upload).not.toHaveBeenCalled();
  });

  it('ошибка Storage — toast.error с переводом и null', async () => {
    mockBucket({ upload: vi.fn().mockResolvedValue({ data: { path: 'junk' }, error: { message: 'new row violates row-level security policy' } }) });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await uploadArtwork(ORDER, 'logo', file('a.png', 'image/png'))).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('отказ сети — тост и null, не исключение', async () => {
    mockBucket({ upload: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await uploadArtwork(ORDER, 'logo', file('a.png', 'image/png'))).toBeNull();
    expect(err.mock.calls[0][0]).toContain('нет связи с сервером');
  });
});

describe('artworks: подписанные ссылки', () => {
  beforeEach(() => {
    storageFrom.mockReset();
    vi.restoreAllMocks();
  });

  it('artworkSignedUrl — TTL 600 и ссылка', async () => {
    const b = mockBucket();
    const p = `orders/${ORDER}/logo/a.png`;
    expect(await artworkSignedUrl(p)).toBe('https://s/1?token=t');
    expect(b.createSignedUrl).toHaveBeenCalledWith(p, 600);
  });

  it('artworkSignedUrl: ошибка — тост и null', async () => {
    mockBucket({ createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'junk' }, error: { message: 'Object not found' } }) });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await artworkSignedUrl(`orders/${ORDER}/logo/a.png`)).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('artworkSignedUrls — пакетно, TTL 600, карта путь → ссылка', async () => {
    const a = `orders/${ORDER}/logo/a.png`;
    const c = `orders/${ORDER}/logo/c.png`;
    const b = mockBucket({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: a, signedUrl: 'u-a', error: null }, { path: c, signedUrl: 'u-c', error: null }],
        error: null,
      }),
    });
    expect(await artworkSignedUrls([a, c])).toEqual({ [a]: 'u-a', [c]: 'u-c' });
    expect(b.createSignedUrls).toHaveBeenCalledWith([a, c], 600);
  });

  it('artworkSignedUrls: пустой список — без запроса', async () => {
    const b = mockBucket();
    expect(await artworkSignedUrls([])).toEqual({});
    expect(b.createSignedUrls).not.toHaveBeenCalled();
  });

  it('artworkSignedUrls: файл без ссылки пропущен и назван тостом', async () => {
    const a = `orders/${ORDER}/logo/a.png`;
    const c = `orders/${ORDER}/logo/c.png`;
    mockBucket({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: a, signedUrl: 'u-a', error: null }, { path: c, signedUrl: '', error: 'Either the object does not exist or you do not have access to it' }],
        error: null,
      }),
    });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await artworkSignedUrls([a, c])).toEqual({ [a]: 'u-a' });
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('artworkSignedUrls: ошибка запроса — тост и null', async () => {
    mockBucket({ createSignedUrls: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await artworkSignedUrls([`orders/${ORDER}/logo/a.png`])).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });
});

describe('artworks: удаление', () => {
  beforeEach(() => {
    storageFrom.mockReset();
    vi.restoreAllMocks();
  });

  it('ждёт ответ и возвращает true', async () => {
    const b = mockBucket();
    const p = `orders/${ORDER}/logo/a.png`;
    expect(await removeArtwork(p)).toBe(true);
    expect(b.remove).toHaveBeenCalledWith([p]);
  });

  it('ошибка — тост и false', async () => {
    mockBucket({ remove: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await removeArtwork(`orders/${ORDER}/logo/a.png`)).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('RLS не дал удалить (пустой ответ без ошибки) — тост и false, а не «удалено»', async () => {
    mockBucket({ remove: vi.fn().mockResolvedValue({ data: [], error: null }) });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await removeArtwork(`orders/${ORDER}/logo/a.png`)).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });
});
