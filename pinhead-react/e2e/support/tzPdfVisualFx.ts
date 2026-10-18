import { expect, type Page } from '@playwright/test';
import { tzFixture } from './orderFlowFx';

/**
 * Эталон PDF ТЗ образца 67108 (веха 6+7, задача 7, шаг 4): PDF собирается В
 * СТРАНИЦЕ движком приложения из фикстуры образца (`fixtures/67108.json` +
 * `catalogs.json`), с датой оформления 20.10.2026, адресом `https://example.test`
 * и детерминированными картинками (байты фикстур e2e, плоский силуэт). Страницы
 * рисует pdfjs в canvas (масштаб 2) — снимается элемент canvas.
 *
 * Сеть не нужна: Storage и разметка флэта — зависимостями движка (`deps`).
 */
export const TZ_VISUAL_ISSUED = '2026-10-20';
export const TZ_VISUAL_ORIGIN = 'https://example.test';
export const TZ_VISUAL_NOW = '2026-10-20T10:00:00+03:00';

const FLAT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760">'
  + '<path id="garment" fill="#ffffff" stroke="#111111" stroke-width="2" d="M150 40h300l140 120-70 90-60-40v510H140V210l-60 40-70-90z"/></svg>';
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#1e5aa8"/>'
  + '<circle cx="50" cy="25" r="15" fill="#f2c230"/></svg>';

/** Собрать PDF 67108 и нарисовать страницы `pages` в canvas `#tz-page-<n>`; вернуть число страниц */
export async function renderTz67108(page: Page, pages: number[]): Promise<number> {
  const png = tzFixture('logo.png').toString('base64');
  const jpg = tzFixture('label-photo.jpg').toString('base64');
  const total = await page.evaluate(async ({ want, png64, jpg64, flatSvg, logoSvg, issuedOn, appOrigin }) => {
    const { loadFixture, fixtureCatalogs } = await import('/src/orderstudio/fixtures/loadFixture.testutil.ts');
    const { tzGroups } = await import('/src/orderstudio/tz/model/tzGroups.ts');
    const { buildTzPdf } = await import('/src/orderstudio/tz/pdf/tzPdf.ts');
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { order, group } = loadFixture('67108');
    const groups = tzGroups(order);
    const download = async (_id: string, path: string) => {
      if (/\.png$/i.test(path)) return new Blob([bytes(png64)], { type: 'image/png' });
      if (/\.jpe?g$/i.test(path)) return new Blob([bytes(jpg64)], { type: 'image/jpeg' });
      if (/\.svg$/i.test(path)) return new Blob([logoSvg], { type: 'image/svg+xml' });
      return null;
    };
    const { blob } = await buildTzPdf(
      { order, groups: [groups[group]], catalogs: fixtureCatalogs(), issuedOn, appOrigin },
      { download, flatMarkup: async () => ({ markup: flatSvg, flatMm: { w: 600, h: 760 }, removed: [] }) },
    );
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;inset:0 auto auto 0;z-index:2147483647;background:#fff';
    document.body.append(box);
    for (const n of want) {
      const p = await doc.getPage(n);
      const viewport = p.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.id = `tz-page-${n}`;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.cssText = 'display:block;background:#fff';
      box.append(canvas);
      await p.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    }
    const count = doc.numPages;
    await doc.destroy();
    return count;
  }, {
    want: pages, png64: png, jpg64: jpg, flatSvg: FLAT_SVG, logoSvg: LOGO_SVG,
    issuedOn: TZ_VISUAL_ISSUED, appOrigin: TZ_VISUAL_ORIGIN,
  });
  for (const n of pages) await expect(page.locator(`#tz-page-${n}`)).toBeVisible();
  return total;
}
