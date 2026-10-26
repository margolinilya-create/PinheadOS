/**
 * ZIP без сжатия («stored») для файлов печати (веха 5в, Э4а): PNG и PDF уже
 * сжаты, поэтому архиватор без Deflate не теряет в весе и не требует новой
 * зависимости (`fflate` — только с согласия владельца). Имена — UTF-8 (флаг 11),
 * дата — фиксированная (архив воспроизводим побайтно).
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 2026-01-01 00:00 в формате DOS */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function makeZip(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, e.data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, DOS_TIME, true);
    central.setUint16(14, DOS_DATE, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, e.data.length, true);
    central.setUint32(24, e.data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** PNG с `pHYs` нужного DPI (холст браузера пишет PNG без него — RIP читал бы 72 dpi) */
export function withPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((v, i) => png[i] !== v)) return png;
  const ihdrEnd = 8 + 8 + 13 + 4;
  const ppm = Math.round(dpi / 0.0254);
  const body = new Uint8Array(4 + 9);
  body.set([0x70, 0x48, 0x59, 0x73]);
  const dv = new DataView(body.buffer);
  dv.setUint32(4, ppm);
  dv.setUint32(8, ppm);
  body[12] = 1;
  const chunk = new Uint8Array(4 + 13 + 4);
  new DataView(chunk.buffer).setUint32(0, 9);
  chunk.set(body, 4);
  new DataView(chunk.buffer).setUint32(17, crc32(body));
  // прежний pHYs (если был) убирается: два pHYs — ошибка формата
  const rest: Uint8Array[] = [];
  let i = ihdrEnd;
  while (i + 8 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset + i).getUint32(0);
    const type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    const end = i + 12 + len;
    if (type !== 'pHYs') rest.push(png.subarray(i, end));
    i = end;
  }
  const parts = [png.subarray(0, ihdrEnd), chunk, ...rest];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
