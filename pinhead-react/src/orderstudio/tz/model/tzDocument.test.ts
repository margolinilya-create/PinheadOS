import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesLabel, newSalesOrder, newSalesPrint } from '../../model/factory';
import { duplicateInColor } from '../../model/itemOps';
import { EMBROIDERY_EFFECTS, SCREEN_EFFECTS } from '../../screens/labels';
import { FIXTURE_OPTS, fixtureCatalogs } from '../../fixtures/loadFixture.testutil';
import { tzGroups } from './tzGroups';
import { SPECIAL_LABELS, byColor, fmtDate, tzDocument } from './tzDocument';
import { tzGrid } from './tzGrid';

const cat = fixtureCatalogs();

function docOf(items: ReturnType<typeof newSalesItem>[], patch = {}) {
  const order = newSalesOrder({ id: 'o1', number: 'PH-1', items, ...patch });
  return tzDocument(order, tzGroups(order)[0], cat, FIXTURE_OPTS);
}

const item = (patch = {}) => newSalesItem({
  product_type: 'Футболка',
  fabric_code: 'medas-kulirnaya-100-180',
  size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 1, M: 2 } }] },
  ...patch,
});

describe('tzDocument — граничные случаи', () => {
  it('бирок нет — labels.none', () => {
    const doc = docOf([item()]);
    expect(doc.labels).toEqual({ items: [], none: true, sizeBlank: false, compositionBlank: false });
  });

  it('схема с неизвестным id — «<id> (нет в справочнике)»; без схемы — пусто', () => {
    const doc = docOf([item({ labels: [
      newSalesLabel({ label_type: 'brand', attach_scheme: 'no-such' }),
      newSalesLabel({ label_type: 'mystery' }),
    ] })]);
    expect(doc.labels.items[0].scheme).toBe('no-such (нет в справочнике)');
    expect(doc.labels.items[1]).toMatchObject({ kind: 'mystery', scheme: '', variant: '' });
  });

  it('разный tz_comment печатается по цветам, одинаковый — один раз', () => {
    const a = item({ tz_comment: 'Вышивка в цвет' });
    const b = { ...duplicateInColor(a, 'Белый'), tz_comment: 'Вышивка тёмно-синяя' };
    expect(docOf([a, b]).header.comments).toEqual([
      { label: 'Чёрный', text: 'Вышивка в цвет' }, { label: 'Белый', text: 'Вышивка тёмно-синяя' },
    ]);
    const c = { ...duplicateInColor(a, 'Белый'), tz_comment: ' Вышивка в цвет ' };
    expect(docOf([a, c]).header.comments).toEqual([{ label: null, text: 'Вышивка в цвет' }]);
    expect(byColor([{ item: a, text: '' }])).toEqual([]);
  });

  it('зона без строки матрицы — «Другое: <зона>» отдельной строкой матрицы', () => {
    const doc = docOf([item({ prints: [newSalesPrint({ zone: 'Спина справа по втачке', method: 'embroidery' })] })]);
    expect(doc.prints[0]).toMatchObject({ row: 'other', rowLabel: 'Другое: Спина справа по втачке', mockup: null });
    expect(doc.fabric.matrix.at(-1)).toEqual({ row: 'other', rowLabel: 'Другое: Спина справа по втачке', cols: ['В'] });
    expect(doc.fabric.matrix).toHaveLength(10);
  });

  it('подрядчик у шелкографии — столбец П', () => {
    const doc = docOf([item({ prints: [newSalesPrint({ zone: 'Спина', method: 'silkscreen', contractor: 'Цех-партнёр', contractor_days: 3 })] })]);
    expect(doc.prints[0]).toMatchObject({ column: 'П', contractor: 'Цех-партнёр', contractorDays: 3 });
    expect(doc.fabric.matrix.find((r) => r.row === 'back')?.cols).toEqual(['П']);
  });

  it('сетка нанесения — только его размеры; размер вне ряда — доп. колонкой', () => {
    const it1 = item({ size_grid: { sizes: ['S', 'M', '5XL'], rows: [{ color: 'Чёрный', sizes: { S: 1, M: 2, '5XL': 4 } }] },
      prints: [newSalesPrint({ zone: 'Спина', sizes: ['M', '5XL'] })] });
    const doc = docOf([it1]);
    expect(doc.fabric.grid.sizes.at(-1)).toBe('5XL');
    expect(doc.fabric.grid.total).toBe(7);
    expect(doc.prints[0].grid.total).toBe(6);
  });

  it('неактивный размер и пустая позиция в сетку не идут', () => {
    const a = item({ size_grid: { sizes: ['S'], rows: [{ color: 'Чёрный', sizes: { S: 1, M: 9 } }] } });
    const empty = { ...duplicateInColor(a, 'Белый') };
    const g = tzGrid([a, empty]);
    expect(g.rows).toEqual([{ color: 'Чёрный', cells: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0], total: 1 }]);
  });

  it('нанесения в разном порядке у позиций группы — Pantone и комментарий по ключу, а не по номеру', () => {
    const chest = newSalesPrint({ zone: 'Грудь', method: 'silkscreen', width_mm: 100, height_mm: 80, artwork_path: 'orders/o1/a.png' });
    const back = newSalesPrint({ zone: 'Спина', method: 'silkscreen', width_mm: 300, height_mm: 400, artwork_path: 'orders/o1/b.png' });
    const black = item({ prints: [
      { ...chest, pantone: ['White'], comment: 'грудь чёрной' },
      { ...back, pantone: ['Red 032 C'], comment: 'спина чёрной' },
    ] });
    const white = {
      ...duplicateInColor(black, 'Белый'),
      size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Белый', sizes: { S: 1, M: 1 } }] },
      prints: [
        { ...back, key: 'wb', pantone: ['Navy 289 C'], comment: 'спина белой' },
        { ...chest, key: 'wc', pantone: ['Black 6 C'], comment: 'грудь белой' },
      ],
    };
    const order = newSalesOrder({ id: 'o1', number: 'PH-1', items: [black, white] });
    expect(tzGroups(order)).toHaveLength(1);
    const doc = docOf([black, white]);
    expect(doc.prints.map((p) => p.zone)).toEqual(['Грудь', 'Спина']);
    expect(doc.prints[0]).toMatchObject({ pantone: 'Чёрный: White; Белый: Black 6 C', comment: 'Чёрный: грудь чёрной; Белый: грудь белой' });
    expect(doc.prints[1]).toMatchObject({ pantone: 'Чёрный: Red 032 C; Белый: Navy 289 C', comment: 'Чёрный: спина чёрной; Белый: спина белой' });
  });

  it('две позиции одного цвета в группе — одна строка сетки, штуки сложены', () => {
    const a = item();
    const b = { ...duplicateInColor(a, 'Чёрный'), size_grid: { sizes: ['S', 'M'], rows: [{ color: ' Чёрный ', sizes: { S: 4, M: 0 } }] } };
    const g = tzGrid([a, b]);
    expect(g.rows).toEqual([{ color: 'Чёрный', cells: [0, 0, 5, 2, 0, 0, 0, 0, 0, 0], total: 7 }]);
    expect(g.total).toBe(7);
  });

  it('дата оформления и срок — «дд.мм.гггг»; мусор — пусто; ссылка подвала без двойного «/»', () => {
    expect(fmtDate('2026-01-05')).toBe('05.01.2026');
    expect(fmtDate('не дата')).toBe('');
    const order = newSalesOrder({ id: 'o1', items: [item()] });
    const doc = tzDocument(order, tzGroups(order)[0], cat, { issuedOn: '2026-10-18', appOrigin: 'https://x.ru/' });
    expect(doc.footer.link).toBe('https://x.ru/sales/o1');
    expect(doc.footer.group).toBe('PH-черновик · ТЗ 1 из 1');
  });

  it('ткань клиента — текстом позиции; поставщик — у позиции, иначе из каталога ткани', () => {
    const doc = docOf([item({ client_fabric: true, main_fabric: 'Своя ткань клиента', fabric_code: '' })]);
    expect(doc.fabric.main).toBe('Своя ткань клиента');
    expect(doc.fabric.supplier).toBe('');
  });
});

describe('подписи эффектов — паритет с экраном', () => {
  it('SPECIAL_LABELS = SCREEN_EFFECTS и EMBROIDERY_EFFECTS без пустого', () => {
    const map = (list: { key: string; label: string }[]) => Object.fromEntries(list.filter((e) => e.key).map((e) => [e.key, e.label]));
    expect(SPECIAL_LABELS.silkscreen).toEqual(map(SCREEN_EFFECTS));
    expect(SPECIAL_LABELS.embroidery).toEqual(map(EMBROIDERY_EFFECTS));
  });
});
