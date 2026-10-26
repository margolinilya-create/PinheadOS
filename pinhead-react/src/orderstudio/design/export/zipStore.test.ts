import { describe, it, expect } from 'vitest';
import { crc32, makeZip, withPngDpi } from './zipStore';
import { readPngDpi } from '../assets/loadAsset';
import { pngBytes } from '../assets/bytes.testutil';

const u8 = (s: string) => new TextEncoder().encode(s);

describe('makeZip — архив без сжатия (веха 5в, Э4а)', () => {
  it('crc32 эталона', () => {
    expect(crc32(u8('123456789')).toString(16)).toBe('cbf43926');
  });
  it('записи читаются обратно: подписи, число записей, имена UTF-8, данные как есть', () => {
    const zip = makeZip([{ name: 'PH-1234_p1_front.png', data: u8('PNGDATA') }, { name: 'читать.txt', data: u8('привет') }]);
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const endAt = zip.length - 22;
    expect(dv.getUint32(endAt, true)).toBe(0x06054b50);
    expect(dv.getUint16(endAt + 10, true)).toBe(2);
    const cdAt = dv.getUint32(endAt + 16, true);
    expect(dv.getUint32(cdAt, true)).toBe(0x02014b50);
    const nameLen = dv.getUint16(26, true);
    expect(new TextDecoder().decode(zip.subarray(30, 30 + nameLen))).toBe('PH-1234_p1_front.png');
    expect(new TextDecoder().decode(zip.subarray(30 + nameLen, 30 + nameLen + 7))).toBe('PNGDATA');
    expect(dv.getUint32(14, true)).toBe(crc32(u8('PNGDATA')));
    expect(dv.getUint16(6, true) & 0x0800).toBe(0x0800);
  });
});

describe('withPngDpi', () => {
  it('PNG без pHYs получает 300 dpi; прежний pHYs заменяется, не дублируется', () => {
    expect(readPngDpi(withPngDpi(pngBytes(10, 10), 300))).toBeCloseTo(300, 0);
    const twice = withPngDpi(pngBytes(10, 10, 72), 300);
    expect(readPngDpi(twice)).toBeCloseTo(300, 0);
    const n = new TextDecoder('latin1').decode(twice).split('pHYs').length - 1;
    expect(n).toBe(1);
  });
  it('не PNG — как есть', () => {
    const b = u8('not a png at all, really not');
    expect(withPngDpi(b, 300)).toBe(b);
  });
});
