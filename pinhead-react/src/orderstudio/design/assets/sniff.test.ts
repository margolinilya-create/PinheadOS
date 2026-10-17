import { describe, it, expect } from 'vitest';
import { MSG_AI, MSG_BROKEN, MSG_FORMAT, MSG_MISMATCH, MSG_TOO_BIG, sniffArtwork } from './sniff';
import { jpegBytes, pngBytes, textBytes, webpBytes } from './bytes.testutil';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';

describe('sniffArtwork — тип по содержимому', () => {
  it('PNG, JPEG, WEBP — с размерами из заголовка', () => {
    expect(sniffArtwork(pngBytes(640, 480), 'logo.png')).toEqual({ ok: true, kind: 'png', width: 640, height: 480 });
    expect(sniffArtwork(jpegBytes(800, 600), 'photo.JPG')).toEqual({ ok: true, kind: 'jpeg', width: 800, height: 600 });
    expect(sniffArtwork(jpegBytes(800, 600), 'photo.jpeg')).toMatchObject({ ok: true, kind: 'jpeg' });
    expect(sniffArtwork(webpBytes(1000, 500), 'a.webp')).toEqual({ ok: true, kind: 'webp', width: 1000, height: 500 });
  });

  it('SVG: с <?xml, с BOM и пробелами', () => {
    expect(sniffArtwork(textBytes(SVG), 'a.svg')).toEqual({ ok: true, kind: 'svg' });
    expect(sniffArtwork(textBytes(`<?xml version="1.0"?>\n${SVG}`), 'a.svg')).toMatchObject({ ok: true, kind: 'svg' });
    expect(sniffArtwork(textBytes(`\uFEFF  \n${SVG}`), 'a.svg')).toMatchObject({ ok: true, kind: 'svg' });
  });

  it('PDF и AI, совместимый с PDF', () => {
    expect(sniffArtwork(textBytes('%PDF-1.7\n…'), 'a.pdf')).toEqual({ ok: true, kind: 'pdf' });
    expect(sniffArtwork(textBytes('%PDF-1.5\n…'), 'logo.ai')).toEqual({ ok: true, kind: 'pdf' });
  });
});

describe('sniffArtwork — отказы', () => {
  it('PNG под именем .svg — расхождение', () => {
    expect(sniffArtwork(pngBytes(10, 10), 'logo.svg')).toEqual({ ok: false, error: MSG_MISMATCH });
  });

  it('SVG под именем .png — расхождение', () => {
    expect(sniffArtwork(textBytes(SVG), 'logo.png')).toEqual({ ok: false, error: MSG_MISMATCH });
  });

  it('AI без %PDF — просьба пересохранить', () => {
    expect(sniffArtwork(textBytes('%!PS-Adobe-3.0 EPSF'), 'logo.ai')).toEqual({ ok: false, error: MSG_AI });
  });

  it('PSD, TIFF, EPS и без расширения — формат не для холста', () => {
    for (const name of ['a.psd', 'a.tiff', 'a.tif', 'a.eps', 'noext']) {
      expect(sniffArtwork(pngBytes(10, 10), name)).toEqual({ ok: false, error: MSG_FORMAT });
    }
  });

  it('SVG из Illustrator: комментарий и DOCTYPE перед корнем — узнаётся (отказ даст санитайзер с подсказкой)', () => {
    const ai = '<?xml version="1.0"?>\n<!-- Generator: Adobe Illustrator 16.0 -->\n'
      + '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY ns_x "x">]>\n' + SVG;
    expect(sniffArtwork(textBytes(ai), 'logo.svg')).toMatchObject({ ok: true, kind: 'svg' });
    expect(sniffArtwork(textBytes(`<!-- Generator: Sketch -->\n${SVG}`), 'logo.svg')).toMatchObject({ ok: true, kind: 'svg' });
  });

  it('HTML с DOCTYPE html или посторонним корнем перед <svg> — не SVG', () => {
    expect(sniffArtwork(textBytes('<!DOCTYPE html><svg/>'), 'x.svg').ok).toBe(false);
    expect(sniffArtwork(textBytes('<?xml version="1.0"?><html><svg/></html>'), 'x.svg').ok).toBe(false);
  });

  it('HTML под именем .svg — не SVG', () => {
    expect(sniffArtwork(textBytes('<html><svg/></html>'), 'x.svg')).toEqual({ ok: false, error: MSG_FORMAT });
  });

  it('текст без <svg> после <?xml — не SVG', () => {
    expect(sniffArtwork(textBytes('<?xml version="1.0"?><html/>'), 'x.svg').ok).toBe(false);
  });

  it('бомба: сторона больше 12000 px или площадь больше 80 Мп', () => {
    expect(sniffArtwork(pngBytes(12001, 10), 'a.png')).toEqual({ ok: false, error: MSG_TOO_BIG });
    expect(sniffArtwork(pngBytes(10000, 9000), 'a.png')).toEqual({ ok: false, error: MSG_TOO_BIG });
    expect(sniffArtwork(jpegBytes(13000, 100), 'a.jpg')).toEqual({ ok: false, error: MSG_TOO_BIG });
    expect(sniffArtwork(webpBytes(12001, 1), 'a.webp')).toEqual({ ok: false, error: MSG_TOO_BIG });
    expect(sniffArtwork(pngBytes(12000, 6000), 'a.png').ok).toBe(true);
  });

  it('нулевой размер и обрезанный заголовок — повреждён', () => {
    expect(sniffArtwork(pngBytes(0, 10), 'a.png')).toEqual({ ok: false, error: MSG_TOO_BIG });
    expect(sniffArtwork(pngBytes(10, 10).subarray(0, 20), 'a.png')).toEqual({ ok: false, error: MSG_BROKEN });
  });
});
