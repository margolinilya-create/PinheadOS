import { describe, it, expect, vi } from 'vitest';
import { buildKpPdf, KpPdfError } from './kpPdf';
import { FONTS, pdfPages } from './tzPdf.testutil';
import type { KpDoc } from '../kp/kpDocument';

vi.mock('svg2pdf.js', () => import('svg2pdf.js/dist/svg2pdf.es.js'));

const doc = (patch: Partial<KpDoc> = {}): KpDoc => ({
  number: 'PH-1234', date: '26.10.2026', client: 'ООО Ромашка', title: 'Мерч',
  items: [{ key: 'a', title: 'Футболка · Белый', qty: 50, unit: 950, total: 47500, manual: false, leadDays: 7,
    lines: [{ n: 1, zone: 'Грудь', method: 'DTF', size: '250 × 120 мм', unit: 120 }] }],
  subtotal: 47500, prep: 1500, discount: 1000, total: 48000, leadDays: 7, incomplete: false, ...patch,
});

describe('КП в PDF (веха 5в, Э6)', () => {
  it('шапка, позиция с нанесением и ценой, итог со скидкой, срок, нумерация страниц', async () => {
    const blob = await buildKpPdf(doc(), { fonts: async () => FONTS, mockup: async () => null });
    const text = (await pdfPages(blob)).join(' ');
    expect(text).toContain('Коммерческое предложение');
    expect(text).toContain('№ PH-1234 от 26.10.2026');
    expect(text).toContain('Клиент: ООО Ромашка');
    expect(text).toContain('Грудь');
    expect(text).toContain('250 × 120 мм');
    expect(text).toMatch(/Итого: 48\s000 руб\./);
    expect(text).toMatch(/Скидка: −1\s000 руб\./);
    expect(text).toContain('до 7 рабочих дней');
    expect(text).toContain('КП PH-1234 · стр. 1 из 1');
  });
  it('много позиций — новые страницы', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ ...doc().items[0], key: `k${i}`, title: `Позиция ${i + 1}` }));
    const pages = await pdfPages(await buildKpPdf(doc({ items }), { fonts: async () => FONTS, mockup: async () => null }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.at(-1)).toContain(`стр. ${pages.length} из ${pages.length}`);
  });
  it('знак вне шрифта — отказ с его перечнем, а не пустой квадрат', async () => {
    await expect(buildKpPdf(doc({ client: 'Кофейня ☕' }), { fonts: async () => FONTS })).rejects.toThrow(KpPdfError);
    await expect(buildKpPdf(doc({ client: 'Кофейня ☕' }), { fonts: async () => FONTS })).rejects.toThrow(/☕/);
  });
});
