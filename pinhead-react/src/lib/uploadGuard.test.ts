import { describe, it, expect } from 'vitest';
import { validateImageUpload, safePathSegment, MAX_UPLOAD_BYTES } from './uploadGuard';

// Мок File: только нужные поля (type/size), без реального Blob.
const f = (type: string, size = 1024): File => ({ type, size, name: 'x' } as unknown as File);

describe('validateImageUpload (security ME-1)', () => {
  it('пускает jpg/png/webp и даёт канонический ext + contentType', () => {
    expect(validateImageUpload(f('image/jpeg'))).toMatchObject({ ok: true, ext: 'jpg', contentType: 'image/jpeg' });
    expect(validateImageUpload(f('image/png'))).toMatchObject({ ok: true, ext: 'png' });
    expect(validateImageUpload(f('image/webp'))).toMatchObject({ ok: true, ext: 'webp' });
  });

  it('РЕЖЕТ SVG (вектор XSS на storage-origin)', () => {
    expect(validateImageUpload(f('image/svg+xml'))).toMatchObject({ ok: false });
  });

  it('РЕЖЕТ text/html и произвольные типы', () => {
    expect(validateImageUpload(f('text/html'))).toMatchObject({ ok: false });
    expect(validateImageUpload(f('application/octet-stream'))).toMatchObject({ ok: false });
    expect(validateImageUpload(f(''))).toMatchObject({ ok: false });
  });

  it('РЕЖЕТ пустой и слишком большой файл', () => {
    expect(validateImageUpload(f('image/png', 0))).toMatchObject({ ok: false });
    expect(validateImageUpload(f('image/png', MAX_UPLOAD_BYTES + 1))).toMatchObject({ ok: false });
  });

  it('регистронезависим по MIME', () => {
    expect(validateImageUpload(f('IMAGE/PNG'))).toMatchObject({ ok: true, ext: 'png' });
  });
});

describe('safePathSegment', () => {
  it('вырезает traversal и опасные символы', () => {
    expect(safePathSegment('../../etc/passwd')).not.toContain('/');
    expect(safePathSegment('a/b\\c')).toBe('a_b_c');
    expect(safePathSegment('ok_name-1.png')).toBe('ok_name-1.png');
  });
  it('не пустой на мусорном входе', () => {
    expect(safePathSegment('/////')).toBe('_____');
    expect(safePathSegment('')).toBe('file');
  });
});
