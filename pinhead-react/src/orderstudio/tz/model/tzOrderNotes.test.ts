import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import { FIXTURE_OPTS, fixtureCatalogs } from '../../fixtures/loadFixture.testutil';
import { tzGroups } from './tzGroups';
import { tzDocument } from './tzDocument';
import { canonicalTzForHash } from './tzHash';
import { layoutTz } from './layoutTz';
import { mono } from './measure.testutil';
import { glyphItems } from './sendGlyphs';

/**
 * Веха 8 (К5): «Комментарий для цехов» (`orders.notes`) печатается в ТЗ блоком
 * «Общее» на странице шапки; строка матрицы нанесения — по коду зоны `zone_id`.
 */
const cat = fixtureCatalogs();

const item = (patch = {}) => newSalesItem({
  product_type: 'Футболка',
  fabric_code: 'medas-kulirnaya-100-180',
  size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 1, M: 2 } }] },
  ...patch,
});

function docOf(patch = {}, items = [item()]) {
  const order = newSalesOrder({ id: 'o1', number: 'PH-1', items, ...patch });
  return { order, doc: tzDocument(order, tzGroups(order)[0], cat, FIXTURE_OPTS) };
}

const texts = (l: ReturnType<typeof layoutTz>) => l.boxes.filter((b) => b.lines).flatMap((b) => b.lines as string[]);

describe('ТЗ — комментарий для цехов (блок «Общее»)', () => {
  it('комментарий попадает в шапку документа без пробелов по краям', () => {
    expect(docOf({ notes: '  Упаковать по 10 шт.  ' }).doc.header.orderNotes).toBe('Упаковать по 10 шт.');
  });

  it('пустой комментарий — ключа нет: хэш прежних ТЗ не меняется', () => {
    const { doc } = docOf({ notes: '   ' });
    expect(doc.header).not.toHaveProperty('orderNotes');
    expect(canonicalTzForHash(doc)).not.toContain('orderNotes');
  });

  it('раскладка печатает строку «Общее» с текстом; без комментария строки нет', () => {
    const withNotes = texts(layoutTz(docOf({ notes: 'Упаковать по 10 шт.' }).doc, mono));
    expect(withNotes).toContain('Общее');
    expect(withNotes.join(' ')).toContain('Упаковать по 10 шт.');
    expect(texts(layoutTz(docOf().doc, mono))).not.toContain('Общее');
  });

  it('длинный комментарий (2000 знаков) не теряется: остаток — на странице продолжения', () => {
    const long = 'слово '.repeat(333).trim();
    const l = layoutTz(docOf({ notes: long }).doc, mono);
    const all = texts(l).join(' ').replace(/\s+/g, ' ');
    expect(all).toContain('Продолжение: Общее');
    expect(all.match(/слово/g)?.length).toBe(333);
  });

  it('знаки вне шрифта в комментарии — пункт чек-листа «Комментарий для цехов» с переходом на «Клиент»', () => {
    const { order, doc } = docOf({ notes: 'Цвет ☺' });
    const items = glyphItems(doc, order.items[0], false);
    expect(items).toHaveLength(1);
    expect(items[0].text).toMatch(/^Комментарий для цехов у/);
    expect(items[0].href).toBe('?tab=client');
  });
});

describe('ТЗ — строка матрицы по коду зоны', () => {
  it('зону переименовали, код прежний — строка та же', () => {
    const { doc } = docOf({}, [item({ prints: [newSalesPrint({ zone: 'Новое имя спины', zone_id: 'back' })] })]);
    expect(doc.prints[0]).toMatchObject({ row: 'back', zone: 'Новое имя спины' });
  });

  it('без кода — по названию справочника, как прежде', () => {
    const name = cat.zonesCatalog.find((z) => z.id === 'back')?.name ?? '';
    const { doc } = docOf({}, [item({ prints: [newSalesPrint({ zone: name })] })]);
    expect(doc.prints[0].row).toBe('back');
  });
});
