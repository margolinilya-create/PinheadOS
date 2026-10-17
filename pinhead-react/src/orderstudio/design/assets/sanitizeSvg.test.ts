import { describe, it, expect } from 'vitest';
import { MSG_DOCTYPE, sanitizeSvg, type SanitizeResult } from './sanitizeSvg';
import { MAX_SVG_BYTES } from '../limits';

const wrap = (inner: string, attrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"${attrs}>${inner}</svg>`;

function ok(r: SanitizeResult): { svg: string; removed: string[] } {
  if (!r.ok) throw new Error(`отказ: ${r.error}`);
  return r;
}

/** Чистый флэт в духе сида DM: только svg/g/path и атрибуты обводки */
const FLAT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760" width="600" height="760">`
  + `<g id="garment" fill="#ffffff" stroke="#1b1f24" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">`
  + `<path d="M10 10 L590 10 L590 750 Z" fill-rule="evenodd"/>`
  + `<path d="M100 100 L200 200" stroke-dasharray="4 3"/>`
  + `</g></svg>`;

describe('sanitizeSvg — чистый флэт не меняется', () => {
  it('ничего не вырезано, <g id="garment"> тот же', () => {
    const r = ok(sanitizeSvg(FLAT));
    expect(r.removed).toEqual([]);
    const garment = (s: string) => s.match(/<g id="garment"[\s\S]*<\/g>/)![0];
    expect(garment(r.svg)).toMatchInlineSnapshot(`"<g id="garment" fill="#ffffff" stroke="#1b1f24" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10 L590 10 L590 750 Z" fill-rule="evenodd"/><path d="M100 100 L200 200" stroke-dasharray="4 3"/></g>"`);
    expect(r.svg).toContain('viewBox="0 0 600 760"');
  });

  it('повторная очистка — тот же текст (идемпотентно)', () => {
    const once = ok(sanitizeSvg(FLAT)).svg;
    const twice = ok(sanitizeSvg(once));
    expect(twice.svg).toBe(once);
    expect(twice.removed).toEqual([]);
  });

  it('градиенты, маски и <use> на свой id остаются', () => {
    const r = ok(sanitizeSvg(wrap(
      '<defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0" stop-color="#f00"/></linearGradient>'
      + '<clipPath id="c"><rect width="10" height="10"/></clipPath><path id="p" d="M0 0h5"/></defs>'
      + '<use href="#p"/><use xlink:href="#p"/><rect fill="url(#g1)" clip-path="url(#c)" width="5" height="5"/>',
    )));
    expect(r.removed).toEqual([]);
    expect(r.svg).toContain('fill="url(#g1)"');
    expect((r.svg.match(/<use /g) ?? []).length).toBe(2);
  });
});

describe('sanitizeSvg — вредное вырезано', () => {
  const cases: [string, string, RegExp][] = [
    ['<script>', wrap('<script>alert(1)</script><rect width="1" height="1"/>'), /script|alert/i],
    ['onload на корне', wrap('<rect width="1" height="1"/>', ' onload="alert(1)"'), /onload|alert/i],
    ['onclick на элементе', wrap('<rect onclick="alert(1)" width="1" height="1"/>'), /onclick|alert/i],
    ['<foreignObject>', wrap('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'), /foreignObject|<div/i],
    ['xlink:href="javascript:"', wrap('<use xlink:href="javascript:alert(1)"/>'), /javascript/i],
    ['<use href="http://…">', wrap('<use href="http://evil.example/x.svg#a"/>'), /evil\.example/],
    ['<image>', wrap('<image href="http://evil.example/p.png" width="1" height="1"/>'), /<image|evil/],
    ['style с url()', wrap('<rect style="background:url(http://evil.example/x)" width="1" height="1"/>'), /evil|style=/],
    ['<style> с @import', wrap('<style>@import url(http://evil.example/a.css);</style>'), /@import|evil|<style/],
    ['<animate>', wrap('<rect width="1" height="1"><animate attributeName="href" to="javascript:alert(1)"/></rect>'), /animate|javascript/],
    ['<set>', wrap('<rect width="1" height="1"><set attributeName="onmouseover" to="alert(1)"/></rect>'), /<set|alert/],
    ['<a href>', wrap('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>'), /<a |javascript/],
    ['fill="url(http…)"', wrap('<rect fill="url(http://evil.example/#g)" width="1" height="1"/>'), /evil/],
    ['xml:base', wrap('<g xml:base="http://evil.example/"><rect width="1" height="1"/></g>'), /xml:base|evil/],
    ['чужой xmlns:*', wrap('<rect width="1" height="1"/>', ' xmlns:ev="http://www.w3.org/2001/xml-events"'), /xml-events|xmlns:ev/],
    ['чужое пространство имён', wrap('<x:evil xmlns:x="urn:evil"><rect width="1" height="1"/></x:evil>'), /urn:evil|x:evil/],
    ['комментарий', wrap('<!-- <script>alert(1)</script> --><rect width="1" height="1"/>'), /<!--|alert/],
    ['инструкция обработки', wrap('<?xml-stylesheet href="http://evil.example/a.xsl"?><rect width="1" height="1"/>'), /xml-stylesheet|evil/],
    ['CDATA', wrap('<desc><![CDATA[<script>alert(1)</script>]]></desc>'), /CDATA|<script/],
  ];

  it.each(cases)('%s', (_name, svg, bad) => {
    const r = ok(sanitizeSvg(svg));
    expect(r.svg).not.toMatch(bad);
    expect(r.removed.length).toBeGreaterThan(0);
  });

  it('атрибут вне белого списка — вырезан и назван', () => {
    const r = ok(sanitizeSvg(wrap('<rect data-x="1" formaction="x" width="1" height="1"/>')));
    expect(r.svg).not.toContain('formaction');
    expect(r.removed.join(' ')).toContain('formaction');
  });
});

describe('sanitizeSvg — отказ целиком', () => {
  it('DOCTYPE и ENTITY (бомба сущностей)', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]>'
      + '<svg xmlns="http://www.w3.org/2000/svg">&b;</svg>';
    expect(sanitizeSvg(bomb).ok).toBe(false);
    expect(sanitizeSvg('<!doctype svg><svg xmlns="http://www.w3.org/2000/svg"/>')).toEqual({ ok: false, error: MSG_DOCTYPE });
    expect(MSG_DOCTYPE).toMatch(/PNG либо PDF/);
  });

  it('битый XML (parsererror)', () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>').ok).toBe(false);
  });

  it('корень не <svg> или не в пространстве SVG', () => {
    expect(sanitizeSvg('<html xmlns="http://www.w3.org/1999/xhtml"/>').ok).toBe(false);
    expect(sanitizeSvg('<svg><rect/></svg>').ok).toBe(false);
  });

  it('больше 5 МБ', () => {
    const big = wrap(`<desc>${'a'.repeat(MAX_SVG_BYTES)}</desc>`);
    expect(sanitizeSvg(big).ok).toBe(false);
  });
});

describe('sanitizeSvg — <use>', () => {
  it('больше 500 <use> — лишние вырезаны', () => {
    const uses = '<use href="#p"/>'.repeat(501);
    const r = ok(sanitizeSvg(wrap(`<defs><path id="p" d="M0 0"/></defs>${uses}`)));
    expect((r.svg.match(/<use /g) ?? []).length).toBe(500);
    expect(r.removed.length).toBeGreaterThan(0);
  });

  it('цепочка <use> → <use> вырезана; <use> на группу с <use> — тоже', () => {
    const r = ok(sanitizeSvg(wrap(
      '<defs><path id="p" d="M0 0"/><use id="u1" href="#p"/><g id="grp"><use href="#p"/></g></defs>'
      + '<use href="#u1"/><use href="#grp"/>',
    )));
    expect(r.svg).not.toContain('href="#u1"');
    expect(r.svg).not.toContain('href="#grp"');
    expect(r.removed.length).toBeGreaterThan(0);
  });

  it('<use> на несуществующий id вырезан', () => {
    const r = ok(sanitizeSvg(wrap('<use href="#none"/>')));
    expect(r.svg).not.toContain('<use');
  });
});

describe('sanitizeSvg — режим сцены (PDF)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';

  it('<text>, <tspan> и <image> с data:image/png;base64 разрешены', () => {
    const r = ok(sanitizeSvg(wrap(`<text x="1" y="2" font-size="3">Клиент<tspan>A</tspan></text><image href="${PNG}" width="1" height="1"/>`), 'scene'));
    expect(r.removed).toEqual([]);
    expect(r.svg).toContain('<image');
    expect(r.svg).toContain('Клиент');
  });

  it('<image> с внешним адресом или data:text/html — вырезан', () => {
    for (const href of ['http://evil.example/a.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png,raw', 'javascript:alert(1)']) {
      const r = ok(sanitizeSvg(wrap(`<image href="${href}" width="1" height="1"/>`), 'scene'));
      expect(r.svg).not.toContain(href);
    }
  });

  it('вне сцены <text> не разрешён (логотип и флэт)', () => {
    const r = ok(sanitizeSvg(wrap('<text>x</text>')));
    expect(r.svg).not.toContain('<text');
  });

  it('data-атрибуты сцены остаются', () => {
    const r = ok(sanitizeSvg(wrap('<g data-layer="garment"><rect width="1" height="1"/></g>'), 'scene'));
    expect(r.svg).toContain('data-layer="garment"');
  });
});
