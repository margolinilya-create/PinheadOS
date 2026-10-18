import { describe, it, expect } from 'vitest';
import { FIXTURE_NAMES, fixtureCatalogs, loadFixture } from '../../fixtures/loadFixture.testutil';
import type { SalesOrder } from '../../model/types';
import { SERVER_SEND_RULES, canSend, sendChecklist, type CheckCtx } from './sendChecklist';

const cat = fixtureCatalogs();
const seller: CheckCtx = { marginPct: 30, minMarginPct: 25, audience: 'seller' };
const ms: CheckCtx = { ...seller, audience: 'ms' };

/** Заказ образца, готовый к отправке: клиент есть, у 67108 «прочее» без макета — законно */
function ready(name: (typeof FIXTURE_NAMES)[number]): SalesOrder {
  const { order } = loadFixture(name);
  return { ...order, customer: order.customer || 'Клиент' };
}

/** PDF ТЗ у каждой позиции — как после отправки */
function withPdf(order: SalesOrder): SalesOrder {
  const path = `orders/${order.id}/tz/0b9c7e4e-1111-4222-8333-444455556666-PH-1-g0badf00d-ca1b2c3d4e5f6-model.pdf`;
  return { ...order, items: order.items.map((i) => ({ ...i, tz_pdf_path: path })) };
}

const setItem = (o: SalesOrder, i: number, patch: Partial<SalesOrder['items'][number]>): SalesOrder =>
  ({ ...o, items: o.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

describe('sendChecklist — фикстуры', () => {
  it.each(FIXTURE_NAMES)('%s: полный заказ — пусто, можно отправлять (продавец и МС с PDF)', (name) => {
    expect(sendChecklist(ready(name), cat, seller)).toEqual([]);
    expect(sendChecklist(withPdf(ready(name)), cat, ms)).toEqual([]);
    expect(canSend([])).toBe(true);
  });

  it('по одному сломанному полю — один пункт с текстом и ссылкой', () => {
    const o = ready('63886');
    const key = o.items[0].key;
    const cases: [SalesOrder, string, string][] = [
      [{ ...o, customer: '' }, 'Укажите клиента', '?tab=client'],
      [{ ...o, due_date: '' }, 'Укажите срок сдачи', '?tab=client'],
      [setItem(o, 0, { fabric_code: '', main_fabric: '' }), 'Выберите ткань у позиции «Футболка Old Money, чёрный»', `?tab=item&item=${key}`],
      [setItem(o, 0, { size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: {} }] } }), 'Заполните размерную сетку позиции «Футболка Old Money, чёрный»', `?tab=item&item=${key}`],
      [setItem(o, 0, { prints: [{ ...o.items[0].prints[0], width_mm: null }] }), 'Укажите размер в мм у нанесения 1 позиции «Футболка Old Money, чёрный»', `?tab=item&item=${key}`],
      [setItem(o, 0, { labels: [{ ...o.items[0].labels[0], preview_paths: [] }] }), 'Добавьте превью бирки 1 позиции «Футболка Old Money, чёрный» или отметьте её бланком', `?tab=item&item=${key}`],
    ];
    for (const [order, text, href] of cases) {
      // правка только первой позиции у 63886 ещё и разводит группу (бирка) — это неблокирующий пункт, его проверяет свой тест
      const items = sendChecklist(order, cat, seller).filter((i) => i.blocking);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ text, href, blocking: true, ok: false });
      expect(canSend(items)).toBe(false);
    }
  });

  it('пустой заказ — «Добавьте хотя бы одно изделие»', () => {
    expect(sendChecklist({ ...ready('63886'), items: [] }, cat, seller).map((i) => i.text)).toEqual(['Добавьте хотя бы одно изделие']);
  });
});

describe('sendChecklist — паритет с сервером (SERVER_SEND_RULES)', () => {
  it.each(FIXTURE_NAMES)('%s: позиция без PDF ТЗ — блокирующий пункт tz_pdf_path (МС)', (name) => {
    const o = withPdf(ready(name));
    const items = sendChecklist(setItem(o, 0, { tz_pdf_path: '' }), cat, ms);
    expect(items.find((i) => i.rule === 'tz_pdf_path')).toMatchObject({ blocking: true });
    const alien = sendChecklist(setItem(o, 0, { tz_pdf_path: 'orders/другой/tz/x-g0badf00d-ca1b2c3d4e5f6-m.pdf' }), cat, ms);
    expect(alien.some((i) => i.rule === 'tz_pdf_path')).toBe(true);
  });

  it.each(FIXTURE_NAMES)('%s: нанесение dtf без макета — блокирующий пункт artwork_path_except_other', (name) => {
    const o = ready(name);
    const broken = setItem(o, 0, { prints: [{ ...o.items[0].prints[0], method: 'dtf', artwork_path: '' }, ...o.items[0].prints.slice(1)] });
    for (const ctx of [seller, ms]) {
      expect(sendChecklist(broken, cat, ctx).find((i) => i.rule === 'artwork_path_except_other')).toMatchObject({ blocking: true });
    }
  });

  it('«прочее» без макета серверное правило не нарушает; перечень правил — два', () => {
    expect(SERVER_SEND_RULES).toEqual(['tz_pdf_path', 'artwork_path_except_other']);
    const o = ready('67108');
    expect(o.items[0].prints[5]).toMatchObject({ method: 'other', artwork_path: '' });
    expect(sendChecklist(o, cat, seller)).toEqual([]);
  });

  it('продавцу PDF не нужен (его собирает отправка), с withTzPdf — нужен', () => {
    const o = ready('63886');
    expect(sendChecklist(o, cat, seller).some((i) => i.rule === 'tz_pdf_path')).toBe(false);
    expect(sendChecklist(o, cat, { ...seller, withTzPdf: true }).filter((i) => i.rule === 'tz_pdf_path')).toHaveLength(2);
  });
});

describe('sendChecklist — тексты', () => {
  it('МС — форма факта без ссылки; продавец — действие со ссылкой', () => {
    const o = ready('68180-tee');
    const broken = setItem(o, 0, { prints: [{ ...o.items[0].prints[0], artwork_path: '' }] });
    const s = sendChecklist(broken, cat, seller).find((i) => i.rule === 'artwork_path_except_other');
    const m = sendChecklist(broken, cat, ms).find((i) => i.rule === 'artwork_path_except_other');
    expect(s).toMatchObject({ text: 'Добавьте макет к нанесению 1 позиции «Футболка FREE FIT, чёрный»', href: '?tab=item&item=68180-tee-black' });
    expect(m).toMatchObject({ text: 'У нанесения 1 «Футболка FREE FIT, чёрный» нет макета — верните менеджеру', href: null });
  });

  it('знаки вне шрифта — поле и знаки; невидимые — словами (К10)', () => {
    const o = setItem(ready('68180-tee'), 0, { tz_comment: 'Қазақша әріптер\tи\u200bшрифт' });
    const items = sendChecklist(o, cat, seller);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      blocking: true, href: '?tab=item&item=68180-tee-black',
      text: 'Комментарий ТЗ у «Футболка FREE FIT, чёрный»: знаки Қ, қ, ә, табуляция, невидимый знак U+200B не напечатаются в ТЗ — замените их',
    });
    const forMs = sendChecklist(o, cat, ms).find((i) => i.id.startsWith('glyphs:'));
    expect(forMs?.text).toMatch(/— верните менеджеру$/);
    expect(forMs?.href).toBeNull();
  });

  it('₽ в подвале справочника — пункт без ссылки на заказ', () => {
    const c = { ...cat, tzSettings: { footerText: 'Цена 100 ₽' } };
    const items = sendChecklist(ready('63886'), c, seller);
    expect(items[0]).toMatchObject({ href: null, text: expect.stringContaining('Подвал ТЗ в справочнике у «Футболка Old Money, чёрный»: знаки ₽') });
  });

  it('файл макета больше 20 МБ — текст решения 24 у МС', () => {
    const o = ready('63886');
    const sizes = { [o.items[0].prints[0].artwork_path]: 21 * 1024 * 1024 };
    const m = sendChecklist(withPdf(o), cat, { ...ms, fileSizes: sizes });
    expect(m.map((i) => i.text)).toContain('Файл макета нанесения 1 «Футболка Old Money, чёрный» больше 20 МБ — производство его не примет — верните менеджеру');
  });

  it('у позиций одного ТЗ разные бирки — неблокирующий пункт со ссылкой на первую (у МС — без ссылки)', () => {
    const o = ready('63886');
    expect(o.items).toHaveLength(2);
    const second = o.items[1];
    const broken = setItem(o, 1, { labels: second.labels.map((l, i) => (i === 0 ? { ...l, place: 'Другое место' } : l)) });
    const s = sendChecklist(broken, cat, seller);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ blocking: false, href: `?tab=item&item=${o.items[0].key}` });
    expect(s[0].id).toMatch(/^group-diff:/);
    expect(s[0].text).toMatch(/разное: бирки — в ТЗ попадёт вариант первой позиции\. Выровняйте или вынесите/);
    expect(canSend(s)).toBe(true);
    const m = sendChecklist(withPdf(broken), cat, ms);
    expect(m[0]).toMatchObject({ href: null, text: expect.stringMatching(/— верните менеджеру$/) });
  });

  it('маржа ниже порога и предупреждения моста — не блокируют', () => {
    const items = sendChecklist(ready('63886'), cat, { ...seller, marginPct: 18, bridgeWarnings: ['Флекс уйдёт как термоперенос'] });
    expect(items.map((i) => [i.text, i.blocking])).toEqual([
      ['Маржа 18 % ниже порога 25 %', false], ['Флекс уйдёт как термоперенос', false],
    ]);
    expect(canSend(items)).toBe(true);
  });
});
