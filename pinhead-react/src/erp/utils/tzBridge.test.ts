import { describe, expect, it } from 'vitest';
import { tzToOrderForm, TECH_TO_METHOD } from './tzBridge';
import { effectiveQty, gridTotal } from './orderForm';
import type { BridgeCatalogs, TzOrderLike } from './tzBridge';

/**
 * Мост «ТЗ → производственный заказ».
 *
 * Проверяется РАСКЛАДКА, а не интерфейс: функция чистая, и именно в ней живёт
 * весь риск — молча потерянное поле здесь превращается в заказ, по которому
 * цех сделает не то. Поэтому отдельно проверяется и то, что НЕ переносится:
 * такие вещи обязаны возвращаться списком для человека, а не исчезать.
 */

const CATALOGS: BridgeCatalogs = {
  trimCatalog: [{ code: 'ribana-1x1', name: 'Рибана 1×1' }],
  fabricsCatalog: [{ code: 'medas-kulirnaya-100-160', name: 'Кулирка 160' }],
  // Зоны адресуются полем `id` (ZoneDefinition), ткани и отделка — `code`:
  // каталоги проекта в этом расходятся, и мост обязан понимать оба
  zonesCatalog: [{ id: 'front', name: 'Грудь' }, { code: 'back', name: 'Спина' }],
  findColor: (code) => (code === '01-01' ? { code, name: 'Белый' } : null),
};

/** Заказ ТЗ в той форме, в какой его пишет StepSummary */
function tz(overrides: Record<string, unknown> = {}, items: unknown[] = []): TzOrderLike {
  return {
    id: 'tz-1',
    order_number: 'PH-0042',
    data: {
      name: 'Ромашка',
      managerName: 'Иванов',
      bitrixDeal: '12345',
      deadline: '2026-09-01',
      items,
      ...overrides,
    },
  };
}

const ITEM = {
  type: 'tee',
  sku: { code: 'T-005', name: 'Футболка Oversize', fit: 'oversize', trimCode: 'ribana-1x1' },
  color: '01-01',
  fabric: 'medas-kulirnaya-100-160',
  fit: 'oversize',
  sizes: { S: 10, M: 20, L: 0 },
  customSizes: [{ label: '6XL', qty: 3 }],
  zones: ['front', 'back'],
  zoneTechs: { front: 'screen', back: 'dtg' },
  zonePrints: { front: { colors: 2, size: 'A3', textile: 'white', fx: 'none' } },
  dtgZones: { back: { size: 'A4', textile: 'color' } },
  designNotes: 'логотип по центру',
  sizeComment: 'мерить по груди',
  extras: ['Пришив нашивки'],
};

describe('шапка заказа', () => {
  it('клиент, номер, менеджер и срок приезжают из ТЗ', () => {
    const { form } = tzToOrderForm(tz(), CATALOGS, '2026-08-18');
    expect(form.customer).toBe('Ромашка');
    expect(form.title).toBe('PH-0042 · Ромашка');
    expect(form.manager).toBe('Иванов');
    expect(form.bitrix_id).toBe('12345');
    expect(form.due_date).toBe('2026-09-01');
    expect(form.launch_date).toBe('2026-08-18');
  });

  it('срок в неожиданном формате читается как «не задан» и попадает в список', () => {
    // Пустая дата видна человеку в форме; подставленная наугад — нет
    const { form, notes } = tzToOrderForm(tz({ deadline: 'через 2 недели' }), CATALOGS, '2026-08-18');
    expect(form.due_date).toBe('');
    expect(notes.join(' ')).toMatch(/нет срока сдачи/);
  });

  it('адрес, контакт и срочность уходят в примечание заказа', () => {
    const { form } = tzToOrderForm(tz({
      address: 'Москва, Тверская 1', phone: '+7 999', contact: 'Пётр',
      urgentOption: true, notes: 'звонить после 12',
    }), CATALOGS, '2026-08-18');
    expect(form.notes).toContain('звонить после 12');
    expect(form.notes).toContain('Москва, Тверская 1');
    expect(form.notes).toContain('СРОЧНЫЙ');
    expect(form.notes).toContain('Пётр');
  });

  it('упаковка не угадывается: вид пакета выбирает менеджер', () => {
    // Забытая упаковка видна в форме, угаданная неверная — нет
    const { form } = tzToOrderForm(tz({ packOption: true }), CATALOGS, '2026-08-18');
    expect(form.packaging).toBe('none');
    expect(form.packaging_note).toMatch(/упаковка требуется/);
  });
});

describe('позиция', () => {
  const result = () => tzToOrderForm(tz({}, [ITEM]), CATALOGS, '2026-08-18');

  it('изделие берётся из каталога SKU, а не из кода типа', () => {
    expect(result().items[0].product_type).toBe('Футболка Oversize');
  });

  it('цвет расшифровывается в название', () => {
    expect(result().items[0].variant).toBe('Белый');
  });

  it('крой и отделочный материал переносятся', () => {
    expect(result().items[0].fit).toBe('oversize');
    expect(result().items[0].trim_material).toBe('Рибана 1×1');
  });

  it('размерная сетка собирается из размеров и своих размеров, нули отброшены', () => {
    const grid = result().items[0].size_grid;
    expect(grid?.sizes).toEqual(['S', 'M', '6XL']);
    expect(grid?.rows?.[0]).toEqual({ color: 'Белый', sizes: { S: 10, M: 20, '6XL': 3 } });
    // Количество считает форма из сетки — здесь оно не дублируется
    expect(gridTotal(grid)).toBe(33);
    expect(effectiveQty(result().items[0])).toBe(33);
  });

  it('заметки дизайнера, комментарий размеров и обработки — в примечание позиции', () => {
    const notes = result().items[0].notes;
    expect(notes).toContain('логотип по центру');
    expect(notes).toContain('мерить по груди');
    expect(notes).toContain('Пришив нашивки');
  });
});

describe('нанесения', () => {
  it('каждая зона даёт своё нанесение с методом производства', () => {
    const prints = tzToOrderForm(tz({}, [ITEM]), CATALOGS, '2026-08-18').items[0].prints;
    expect(prints).toHaveLength(2);
    expect(prints[0].method).toBe('silkscreen');
    expect(prints[1].method).toBe('dtg');
    expect(prints[0].zone).toBe('Грудь');
    expect(prints[1].zone).toBe('Спина');
  });

  it('формат макета переводится в миллиметры общей таблицей', () => {
    const prints = tzToOrderForm(tz({}, [ITEM]), CATALOGS, '2026-08-18').items[0].prints;
    expect(prints[0].width_mm).toBe(297); // A3
    expect(prints[0].height_mm).toBe(420);
    expect(prints[1].width_mm).toBe(210); // A4
  });

  it('«Max» размера в миллиметрах не имеет — уходит в комментарий, а не в число', () => {
    // Придуманное число цех принял бы за указание
    const item = { ...ITEM, zones: ['front'], zonePrints: { front: { size: 'Max', colors: 1 } } };
    const print = tzToOrderForm(tz({}, [item]), CATALOGS, '2026-08-18').items[0].prints[0];
    expect(print.width_mm).toBe('');
    expect(print.height_mm).toBe('');
    expect(print.comment).toContain('формат Max');
  });

  it('параметры техники сохраняются текстом рядом с нанесением', () => {
    const print = tzToOrderForm(tz({}, [ITEM]), CATALOGS, '2026-08-18').items[0].prints[0];
    expect(print.comment).toContain('цветов: 2');
    expect(print.comment).toContain('ткань: светлая');
  });

  it('позиция без нанесений не включает блок брендирования', () => {
    const item = { ...ITEM, zones: [], zoneTechs: {}, noPrint: true };
    const built = tzToOrderForm(tz({}, [item]), CATALOGS, '2026-08-18').items[0];
    expect(built.prints).toEqual([]);
    expect(built.has_branding).toBe(false);
  });

  it('неизвестная техника помечается «прочим» и НАЗЫВАЕТСЯ человеку', () => {
    // Молчаливое «прочее» означало бы позицию без этапа печати
    const item = { ...ITEM, zones: ['front'], zoneTechs: { front: 'sublimation' } };
    const { items, notes } = tzToOrderForm(tz({}, [item]), CATALOGS, '2026-08-18');
    expect(items[0].prints[0].method).toBe('other');
    expect(notes.join(' ')).toMatch(/sublimation/);
  });

  it('все техники визарда имеют метод производства', () => {
    // DTG заводился в производственной модели ровно ради этой таблицы
    expect(Object.keys(TECH_TO_METHOD).sort()).toEqual(
      ['dtf', 'dtg', 'embroidery', 'flex', 'screen'],
    );
  });
});

describe('лист закупки', () => {
  it('ткань и отделка позиции становятся строками закупки', () => {
    const { purchase } = tzToOrderForm(tz({}, [ITEM]), CATALOGS, '2026-08-18');
    expect(purchase).toHaveLength(2);
    expect(purchase[0]).toMatchObject({
      kind: 'fabric', role: 'main', name: 'Кулирка 160', color: 'Белый', item_index: 0,
    });
    expect(purchase[1]).toMatchObject({ role: 'trim', name: 'Рибана 1×1' });
  });

  it('количество не подставляется: расход зависит от раскладки', () => {
    // Подставленное число выглядело бы расчётом, которым оно не является
    const { purchase } = tzToOrderForm(tz({}, [ITEM]), CATALOGS, '2026-08-18');
    expect(purchase.every((r) => r.qty_expected === '')).toBe(true);
  });

  it('строки нумеруются по позициям заказа', () => {
    const { purchase } = tzToOrderForm(tz({}, [ITEM, ITEM]), CATALOGS, '2026-08-18');
    expect(purchase.map((r) => r.item_index)).toEqual([0, 0, 1, 1]);
    expect(new Set(purchase.map((r) => r.key)).size).toBe(4);
  });
});

describe('что НЕ переносится — называется, а не теряется', () => {
  it('сумма ТЗ остаётся в ТЗ', () => {
    const { notes } = tzToOrderForm(tz({ total: 125000 }, [ITEM]), CATALOGS, '2026-08-18');
    expect(notes.join(' ')).toMatch(/125\s?000/);
  });

  it('макеты по зонам называются отдельно', () => {
    const item = { ...ITEM, zoneArtworks: { front: 'data:image/png;base64,xxx' } };
    const { notes } = tzToOrderForm(tz({}, [item]), CATALOGS, '2026-08-18');
    expect(notes.join(' ')).toMatch(/Макеты/);
  });

  it('бирки и этикетки переносятся текстом — их читает цех', () => {
    const item = {
      ...ITEM,
      labelConfig: {
        careLabel: { enabled: true, composition: '100% хлопок', country: 'Россия' },
        mainLabel: { option: 'custom', placement: 'neck', material: 'woven' },
        hangTag: { option: 'none' },
      },
    };
    const built = tzToOrderForm(tz({}, [item]), CATALOGS, '2026-08-18').items[0];
    expect(built.labels_note).toContain('100% хлопок');
    expect(built.labels_note).toContain('Россия');
    expect(built.labels_note).toContain('Основная бирка');
    expect(built.labels_note).not.toContain('Хэнгтег');
  });
});

describe('битые и пустые данные', () => {
  it('заказ без позиций даёт форму без позиций, а не падение', () => {
    const { items, purchase } = tzToOrderForm(tz(), CATALOGS, '2026-08-18');
    expect(items).toEqual([]);
    expect(purchase).toEqual([]);
  });

  it('данных нет вовсе — работает на значениях по умолчанию', () => {
    const { form, items } = tzToOrderForm({ data: null }, {}, '2026-08-18');
    expect(form.title).toBe('Заказ из ТЗ');
    expect(items).toEqual([]);
  });

  it('без каталогов коды остаются кодами, а не исчезают', () => {
    const built = tzToOrderForm(tz({}, [ITEM]), {}, '2026-08-18').items[0];
    expect(built.variant).toBe('01-01');
    expect(built.trim_material).toBe('ribana-1x1');
    expect(built.prints[0].zone).toBe('front');
  });
});
