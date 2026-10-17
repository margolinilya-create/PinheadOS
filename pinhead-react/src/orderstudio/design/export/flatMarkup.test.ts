import { describe, it, expect } from 'vitest';
import { decodeDataUrlText, recolorGarment, svgToDataUrl } from './flatMarkup';

const svg = '<svg viewBox="0 0 10 20"><path d="M0 0"/><text>горловина</text></svg>';

describe('flatMarkup (тесты DM)', () => {
  it('svgToDataUrl ↔ decodeDataUrlText (UTF-8)', () => {
    const url = svgToDataUrl(svg);
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(decodeDataUrlText(url)).toBe(svg);
  });

  it('декодит percent-encoded (;utf8,)', () => {
    expect(decodeDataUrlText(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)).toBe(svg);
  });

  it('без запятой — пусто', () => expect(decodeDataUrlText('data:image/svg+xml')).toBe(''));

  it('recolorGarment красит только силуэт', () => {
    const f = '<path id="garment" d="M0 0" fill="#1b1f24"/><rect id="print-area-x" fill="#4f8cff"/>';
    const r = recolorGarment(f, '#ff0000');
    expect(r).toContain('id="garment" d="M0 0" fill="#ff0000"');
    expect(r).toContain('id="print-area-x" fill="#4f8cff"');
  });

  it('recolorGarment без цвета — без изменений', () => {
    const f = '<path id="garment" fill="#1b1f24"/>';
    expect(recolorGarment(f, '')).toBe(f);
  });

  it('recolorGarment: цвет с разметкой не доходит до атрибута', () => {
    const r = recolorGarment('<g id="garment" fill="#000">', '#fff" onload="alert(1)');
    expect(r).toBe('<g id="garment" fill="#ccc">');
  });
});
