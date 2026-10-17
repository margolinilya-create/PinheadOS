import { test, expect } from '@playwright/test';
import { installSupabaseMock, type MockCall } from './support/mockSupabase';

/**
 * Файлы заказа v4 в закрытом бакете `order-artworks` (веха 2, миграция C):
 * клиент `orderstudio/api/artworks.ts` через настоящий supabase-js и мок
 * Storage, который различает загрузку и подпись (задача 0). Проверяется путь,
 * по которому ходит прод: ASCII-ключ `orders/<id>/logo/<uuid>-<имя>`, тип
 * части формы (Storage берёт его, а не опцию `contentType`) и подпись
 * на 600 секунд. Ссылка на скачивание (`artworkDownloadUrl`, для SVG
 * в новой вкладке): storage-js 2.98 НЕ шлёт `download` в теле sign —
 * дописывает `&download=` к ответу сам; это и проверяется.
 */
const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';

test('загрузка макета и подписанная ссылка идут в order-artworks по ASCII-ключу', async ({ page }) => {
  const calls: MockCall[] = [];
  await installSupabaseMock(page, { calls });
  const uploads: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/storage/v1/object/order-artworks/')) {
      uploads.push(req.postDataBuffer()?.toString('latin1') ?? '');
    }
  });
  await page.goto('/?studio=1');

  const r = await page.evaluate(async (orderId) => {
    const api = await import('/src/orderstudio/api/artworks.ts');
    // .ai с пустым типом — как его отдаёт браузер, не знающий расширения
    const path = await api.uploadArtwork(orderId, 'logo', new File(['%!PS-Adobe'], 'Логотип клиента.ai', { type: '' }));
    const url = path ? await api.artworkSignedUrl(path) : null;
    const many = path ? await api.artworkSignedUrls([path]) : null;
    const dl = path ? await api.artworkDownloadUrl(path) : null;
    return { path, url, many, dl };
  }, ORDER);

  expect(r.path).toMatch(new RegExp(`^orders/${ORDER}/logo/[0-9a-f-]{36}-Logotip_klienta\\.ai$`));
  expect(r.url).toContain('token=mock-signed');
  expect(r.many?.[r.path!]).toContain('token=mock-signed');
  // показ — без download, скачивание — с ним (Content-Disposition: attachment)
  expect(r.url).not.toContain('download');
  expect(r.dl).toMatch(/[?&]token=mock-signed&download=$/);

  // тип части формы — из списка бакета, а не octet-stream
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(/Content-Type: application\/postscript/i);
  expect(uploads[0]).not.toMatch(/octet-stream/i);

  const brief = calls.map((c) => [c.kind, c.name]);
  expect(brief).toEqual([
    ['storage', `order-artworks/${r.path}`],
    ['storage-sign', `order-artworks/${r.path}`],
    ['storage-sign', `order-artworks/${r.path}`],
    ['storage-sign', `order-artworks/${r.path}`],
  ]);
  const signs = calls.filter((c) => c.kind === 'storage-sign');
  expect(signs[0]?.body).toMatchObject({ expiresIn: 600 });
  // тело подписи для скачивания — то же, что для показа: download живёт в адресе
  expect(signs[2]?.body).toEqual({ expiresIn: 600 });
});

test('PSD с пустым типом уходит частью формы image/vnd.adobe.photoshop', async ({ page }) => {
  await installSupabaseMock(page);
  const uploads: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/storage/v1/object/order-artworks/')) {
      uploads.push(req.postDataBuffer()?.toString('latin1') ?? '');
    }
  });
  await page.goto('/?studio=1');
  const path = await page.evaluate(async (orderId) => {
    const api = await import('/src/orderstudio/api/artworks.ts');
    return api.uploadArtwork(orderId, 'logo', new File(['8BPS'], 'Макет.psd', { type: '' }));
  }, ORDER);
  expect(path).toMatch(/-Maket\.psd$/);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(/Content-Type: image\/vnd\.adobe\.photoshop/i);
});

test('файл больше 25 МБ и чужой формат не уходят в Storage', async ({ page }) => {
  const calls: MockCall[] = [];
  await installSupabaseMock(page, { calls });
  await page.goto('/?studio=1');

  const r = await page.evaluate(async (orderId) => {
    const api = await import('/src/orderstudio/api/artworks.ts');
    const big = new File([new Uint8Array(api.ARTWORK_MAX_BYTES + 1)], 'big.png', { type: 'image/png' });
    const exe = new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' });
    return [await api.uploadArtwork(orderId, 'logo', big), await api.uploadArtwork(orderId, 'logo', exe)];
  }, ORDER);

  expect(r).toEqual([null, null]);
  expect(calls.filter((c) => c.kind.startsWith('storage'))).toEqual([]);
  await expect(page.getByText('Файл больше 25 МБ')).toBeVisible();
});
