import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { FIXTURE_OPTS, fixtureCatalogs, loadFixture, type FixtureName } from '../../fixtures/loadFixture.testutil';
import { sanitizeSvg } from '../../design/assets/sanitizeSvg';
import { buildSceneSvg, mockupSceneMm } from '../../design/export/buildSceneSvg';
import { addRaster, newPdf, svgInto } from '../../design/export/pdfCore';
import { layoutTz } from '../model/layoutTz';
import { tzGroups } from '../model/tzGroups';
import { NO_CRYPTO_MESSAGE } from '../model/tzHash';
import { fontMeasure } from './drawBoxes';
import { buildAllTzPdf, buildTzPdf, TZ_MAX_BYTES, TzPdfError, type TzPdfInput } from './tzPdf';
import { FONTS, deps, filesByExt, pdfPages, rawPdf, stubLayout } from './tzPdf.testutil';

// svg2pdf: в Vitest — ES-модуль, как в сборке (см. exportPdf.test.ts)
vi.mock('svg2pdf.js', () => import('svg2pdf.js/dist/svg2pdf.es.js'));
vi.mock('../../design/export/pdfCore', async (orig) => {
  const m = await orig<typeof import('../../design/export/pdfCore')>();
  return { ...m, svgInto: vi.fn(m.svgInto), addRaster: vi.fn(m.addRaster) };
});
vi.mock('../../design/export/buildSceneSvg', async (orig) => {
  const m = await orig<typeof import('../../design/export/buildSceneSvg')>();
  return { ...m, buildSceneSvg: vi.fn(m.buildSceneSvg) };
});

function input(name: FixtureName, patch: (i: TzPdfInput) => void = () => {}): TzPdfInput {
  const { order, group } = loadFixture(name);
  const i: TzPdfInput = { order, groups: [tzGroups(order)[group]], catalogs: fixtureCatalogs(), ...FIXTURE_OPTS };
  patch(i);
  return i;
}

let unstub: () => void = () => {};
beforeEach(() => { unstub = stubLayout(); });
afterEach(() => {
  unstub();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('buildTzPdf — настоящий PDF (jsPDF + svg2pdf, шрифты с диска)', () => {
  it('67108: страниц столько, сколько в раскладке; подвал на каждой, шапка; хэш — 12 hex', async () => {
    const inp = input('67108');
    const { blob, hash12, doc } = await buildTzPdf(inp, deps());
    expect(blob.type).toBe('application/pdf');
    expect((await rawPdf(blob)).startsWith('%PDF-')).toBe(true);
    expect(hash12).toMatch(/^[0-9a-f]{12}$/);
    const measure = fontMeasure(await newPdf(FONTS, 'a4'));
    const layout = layoutTz(doc, measure);
    const pages = await pdfPages(blob);
    expect(pages).toHaveLength(layout.pages);
    pages.forEach((text, i) => expect(text).toContain(`стр. ${i + 1}/${pages.length}`));
    expect(pages[0]).toContain('ТЕХНИЧЕСКОЕ ЗАДАНИЕ');
    expect(pages.join('\n')).toContain('Нанесение № 6');
  }, 60_000);

  it('мокап — svgInto в прямоугольник ячейки, outputScale по ячейке, легенды нет; сцена очищена', async () => {
    await buildTzPdf(input('67108'), deps());
    const scenes = vi.mocked(buildSceneSvg).mock.calls.map(([a]) => a);
    expect(scenes.length).toBeGreaterThan(0);
    const mm = mockupSceneMm({ w: 600, h: 760 });
    for (const s of scenes) {
      expect(s.legend).toEqual([]);
      expect(s.outputScale).toBeCloseTo(Math.min(112 / mm.w, 100 / mm.h), 6);
      expect(s.highlight).toBeTruthy();
    }
    const boxes = vi.mocked(svgInto).mock.calls.filter(([, , , b]) => b.w === 112 && b.h === 100);
    expect(boxes).toHaveLength(scenes.length);
    for (const [, , markup] of boxes) {
      const again = sanitizeSvg(markup, 'scene');
      expect(again.ok && again.removed).toEqual([]);
    }
  }, 60_000);

  it('вредный флэт вычищен до svg2pdf', async () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><foreignObject><b>x</b></foreignObject><g id="garment" onload="alert(1)"/></svg>';
    const d = deps({ flatMarkup: vi.fn(async () => ({ markup: evil, flatMm: { w: 600, h: 760 }, removed: [] })) });
    await buildTzPdf(input('67108'), d);
    const markups = vi.mocked(svgInto).mock.calls.map(([, , m]) => m).join('');
    expect(markups).not.toMatch(/foreignObject|onload|alert/);
  }, 60_000);

  it('фото бирки JPEG — addRaster с алиасом пути; тот же путь дважды — один встроенный JPEG', async () => {
    const inp = input('63886', (i) => {
      const l = i.groups[0].items[0].labels[0];
      l.attach_image_path = l.preview_paths[0];
    });
    const { blob } = await buildTzPdf(inp, deps());
    const brand = inp.groups[0].items[0].labels[0].preview_paths[0];
    const calls = vi.mocked(addRaster).mock.calls.filter(([, img]) => img.alias === brand);
    expect(calls).toHaveLength(2);
    expect(calls.every(([, img]) => img.kind === 'jpeg')).toBe(true);
    expect(((await rawPdf(blob)).match(/\/DCTDecode/g) ?? []).length).toBe(2); // brand + note (pack.jpg)
  }, 60_000);

  it('ссылка заметки: https — кликабельна, javascript: — только текстом', async () => {
    const raw = await rawPdf((await buildTzPdf(input('67108'), deps())).blob);
    expect(raw).toContain('/URI (https://ykk.example.ru/catalog/5)');
    expect(raw).not.toMatch(/\/URI \(javascript:/);
  }, 60_000);

  it('две сборки одной модели — одинаковые байты (дата и id файла детерминированы)', async () => {
    const a = new Uint8Array(await (await buildTzPdf(input('68180-sweat'), deps())).blob.arrayBuffer());
    const b = new Uint8Array(await (await buildTzPdf(input('68180-sweat'), deps())).blob.arrayBuffer());
    expect(a.length).toBe(b.length);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(new TextDecoder('latin1').decode(a)).toMatch(/\/CreationDate \(D:20261018000000\+03'00'\)/);
  }, 60_000);
});

describe('buildTzPdf — отказы словами', () => {
  it('логотип не скачался — «логотип нанесения 2 не загрузился»', async () => {
    const inp = input('67108');
    const missing = inp.groups[0].items[0].prints[1].artwork_path;
    const run = buildTzPdf(inp, deps({ download: filesByExt([missing]) }));
    await expect(run).rejects.toThrow(TzPdfError);
    await expect(run).rejects.toThrow('логотип нанесения 2 не загрузился');
  }, 60_000);

  it('силуэт не загрузился — отказ с номером нанесения', async () => {
    await expect(buildTzPdf(input('67108'), deps({ flatMarkup: vi.fn(async () => null) }))).rejects.toThrow(/силуэт изделия для мокапа нанесения \d+ не загрузился/);
  }, 60_000);

  it('больше предела — отказ с размером', async () => {
    expect(TZ_MAX_BYTES).toBe(8 * 1024 * 1024);
    await expect(buildTzPdf(input('68180-polo'), deps({ maxBytes: 1000 }))).rejects.toThrow(/файл ТЗ \d+,\d МБ — больше 0,0 МБ/);
  }, 60_000);

  it('знак вне шрифта (чек-лист обошли) — отказ с названием знаков', async () => {
    const inp = input('68180-polo', (i) => { i.groups[0].items[0].tz_comment = 'Қазақ ₽'; });
    const run = buildTzPdf(inp, deps());
    await expect(run).rejects.toThrow(TzPdfError);
    await expect(run).rejects.toThrow(/Қ.*₽|₽.*Қ/);
  }, 60_000);

  it('нет криптографии — отказ про https; шрифт не доехал — отказ ТЗ', async () => {
    await expect(buildTzPdf(input('68180-polo'), deps({ digest: null }))).rejects.toThrow(NO_CRYPTO_MESSAGE);
    const { MaketPdfError } = await import('../../design/export/maketPages');
    const fonts = async () => { throw new MaketPdfError('шрифт для PDF не загрузился'); };
    await expect(buildTzPdf(input('68180-polo'), deps({ fonts }))).rejects.toThrow(TzPdfError);
  }, 60_000);

  it('не одна группа — отказ', async () => {
    const inp = input('68180-tee', (i) => { i.groups = tzGroups(i.order); });
    await expect(buildTzPdf(inp, deps())).rejects.toThrow('одну группу');
  });
});

describe('buildAllTzPdf — все ТЗ заказа одним файлом (К23)', () => {
  it('68180: три ТЗ подряд, у каждого свой подвал «ТЗ k из 3» и нумерация страниц', async () => {
    const inp = input('68180-tee', (i) => { i.groups = tzGroups(i.order); });
    const pages = await pdfPages(await buildAllTzPdf(inp, deps()));
    for (const k of [1, 2, 3]) expect(pages.some((p) => p.includes(`ТЗ ${k} из 3 · стр. 1/`))).toBe(true);
    const one = await Promise.all(inp.groups.map(async (g) => (await pdfPages((await buildTzPdf({ ...inp, groups: [g] }, deps())).blob)).length));
    expect(pages).toHaveLength(one.reduce((a, b) => a + b, 0));
  }, 90_000);
});
