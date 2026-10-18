import { describe, it, expect } from 'vitest';
import { FIXTURE_NAMES, FIXTURE_OPTS, fixtureCatalogs, loadFixture } from '../../fixtures/loadFixture.testutil';
import { newSalesNoteCard } from '../../model/factory';
import { MIN_PT } from './fitText';
import { BOTTOM, MARGIN, PAGE_H, PAGE_W } from './layoutPager';
import { layoutTz, tzTitle } from './layoutTz';
import { mono } from './measure.testutil';
import { unsupportedChars } from './pdfGlyphs';
import { tzDocument } from './tzDocument';
import { tzGroups } from './tzGroups';
import type { TzDoc } from './tzDocTypes';

function docOf(name: (typeof FIXTURE_NAMES)[number]): TzDoc {
  const { order, group } = loadFixture(name);
  return tzDocument(order, tzGroups(order)[group], fixtureCatalogs(), FIXTURE_OPTS);
}

const texts = (l: ReturnType<typeof layoutTz>, page?: number) =>
  l.boxes.filter((b) => (page === undefined || b.page === page) && b.lines).flatMap((b) => b.lines as string[]);

/** Страницы, чей заголовок начинается с `title` */
function pagesTitled(l: ReturnType<typeof layoutTz>, title: string): number[] {
  return [...new Set(l.boxes.filter((b) => b.bold && b.y === MARGIN && (b.lines ?? [])[0]?.startsWith(title)).map((b) => b.page))];
}

describe('layoutTz — геометрия', () => {
  it.each(FIXTURE_NAMES)('%s: всё внутри полей A4, текст не мельче 8 pt, знаки — из шрифта', (name) => {
    const l = layoutTz(docOf(name), mono);
    expect(l.pages).toBeGreaterThanOrEqual(4);
    for (const b of l.boxes) {
      expect(b.page).toBeGreaterThanOrEqual(1);
      expect(b.page).toBeLessThanOrEqual(l.pages);
      expect(b.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      expect(b.x + b.w).toBeLessThanOrEqual(PAGE_W - MARGIN + 1e-6);
      expect(b.y + b.h).toBeLessThanOrEqual(PAGE_H - MARGIN + 1e-6);
      if (b.lines?.length) expect(b.pt).toBeGreaterThanOrEqual(MIN_PT);
    }
    expect(texts(l).flatMap(unsupportedChars)).toEqual([]);
  });

  it('каждая страница: подвал с текстом справочника, «ТЗ k из m · стр. i/n» и ссылкой', () => {
    const l = layoutTz(docOf('68180-sweat'), mono);
    for (let page = 1; page <= l.pages; page += 1) {
      expect(texts(l, page).join(' ')).toContain(`PH-6818 · ТЗ 2 из 3 · стр. ${page}/${l.pages}`);
      const link = l.boxes.find((b) => b.page === page && b.link);
      expect(link?.link).toBe('https://pinhead-os.vercel.app/sales/68180000-0000-4000-8000-000000068180');
    }
  });

  it('содержимое не заходит в подвал', () => {
    const l = layoutTz(docOf('67108'), mono);
    const footerTop = BOTTOM;
    for (const b of l.boxes.filter((x) => x.y < footerTop)) expect(b.y + b.h).toBeLessThanOrEqual(footerTop + 1e-6);
  });

  it('заголовок — «ТЕХНИЧЕСКОЕ ЗАДАНИЕ К ЗАКАЗУ № [сделка] название»', () => {
    expect(tzTitle(docOf('63886'))).toBe('ТЕХНИЧЕСКОЕ ЗАДАНИЕ К ЗАКАЗУ № [63886] Эквилент Олд Мани');
  });
});

describe('layoutTz — страницы', () => {
  it('нанесений 6 у 67108, 12 — двенадцать страниц нанесений', () => {
    const doc = docOf('67108');
    expect(pagesTitled(layoutTz(doc, mono), 'Нанесение № ')).toHaveLength(6);
    const twelve = { ...doc, prints: [...doc.prints, ...doc.prints].map((p, i) => ({ ...p, n: i + 1 })) };
    expect(pagesTitled(layoutTz(twelve, mono), 'Нанесение № ')).toHaveLength(12);
  });

  it('сетка в 6 строк — продолжение на следующей странице с повтором шапки', () => {
    const doc = docOf('68180-tee');
    const rows = Array.from({ length: 6 }, (_, i) => ({ ...doc.fabric.grid.rows[0], color: `Цвет ${i + 1}` }));
    const six = { ...doc, fabric: { ...doc.fabric, grid: { ...doc.fabric.grid, rows } } };
    const l = layoutTz(six, mono);
    const heads = l.boxes.filter((b) => b.lines?.[0] === 'ЦВ/РАЗМ');
    const fabricPage = pagesTitled(l, 'Полотно и размерная сетка')[0];
    const contPage = pagesTitled(l, 'Полотно и размерная сетка — продолжение сетки')[0];
    expect(contPage).toBe(fabricPage + 1);
    expect(heads.filter((b) => b.page === fabricPage)).toHaveLength(1);
    expect(heads.filter((b) => b.page === contPage)).toHaveLength(1);
    expect(texts(l, fabricPage)).toContain('Цвет 4');
    expect(texts(l, fabricPage)).not.toContain('Цвет 5');
    expect(texts(l, contPage)).toEqual(expect.arrayContaining(['Цвет 5', 'Цвет 6', 'Итого']));
  });

  it('5 заметок — две страницы заметок', () => {
    const { order } = loadFixture('63886');
    const notes = Array.from({ length: 5 }, (_, i) => newSalesNoteCard({ caption: `Заметка ${i + 1}` }));
    const withNotes = { ...order, notes_cards: notes };
    const doc = tzDocument(withNotes, tzGroups(withNotes)[0], fixtureCatalogs(), FIXTURE_OPTS);
    const l = layoutTz(doc, mono);
    expect(pagesTitled(l, 'Заметки к заказу')).toHaveLength(2);
  });

  it('текст не влез и при 8 pt — «(продолжение на стр. N)» и страница «Продолжение: <поле>»', () => {
    const doc = docOf('67108');
    const long = { ...doc, fabric: { ...doc.fabric, modelDescription: 'Очень подробное описание модели. '.repeat(60) } };
    const l = layoutTz(long, mono);
    const contPage = pagesTitled(l, 'Продолжение: Описание модели')[0];
    expect(contPage).toBeGreaterThan(0);
    expect(texts(l)).toContain(`(продолжение на стр. ${contPage})`);
    const all = texts(l).join(' ').replace(/\s+/g, ' ');
    expect((all.match(/Очень подробное описание модели\./g) ?? []).length).toBe(60);
    for (const b of l.boxes) if (b.lines?.length) expect(b.pt).toBeGreaterThanOrEqual(MIN_PT);
  });

  it('текст, который влез бы только мельче 8 pt, остаётся 8 pt и уходит в продолжение', () => {
    const doc = docOf('63886');
    const dense = { ...doc, header: { ...doc.header, productTitle: 'Модель с длинным названием '.repeat(12) } };
    const l = layoutTz(dense, mono);
    const box = l.boxes.find((b) => b.lines?.some((x) => x.startsWith('Модель с длинным')));
    expect(box?.pt).toBe(MIN_PT);
    expect(pagesTitled(l, 'Продолжение: Вид изделия')).toHaveLength(1);
  });
});
