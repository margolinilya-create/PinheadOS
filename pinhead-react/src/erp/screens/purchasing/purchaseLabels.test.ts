// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PURCHASE_FIELD_LABELS, PURCHASE_GROUPS, purchaseSummaryLine } from './purchaseLabels';
import { withoutJsComments } from '../../utils/migrations.testutil';

/**
 * ТРИ КОЛИЧЕСТВА ЗАКУПКИ НАЗЫВАЮТСЯ ПО-РАЗНОМУ (правка 14.09, п. 2;
 * переименованы правкой 05.10, п. 6).
 *
 * Документ 05.10: «При создании есть „фактическое количество", хотя приёмки
 * ещё не было… Разделить три количества: нужно по заказу, заказано
 * поставщику, принято складом». «Фактическое» читалось как факт прихода.
 *
 * Почему сторож поимённый, а не «подписи различны». Переименование задевает
 * ВСЕ величины, и правка, сделанная наполовину, оставила бы на экране два
 * поля с похожим смыслом — то, на что жалуется документ. Проверка «лишь бы
 * не совпадали» прошла бы и на половинной правке, и на откате.
 *
 * Значения подписей — решение владельца, поэтому закреплены дословно.
 */

describe('подписи количеств закупки', () => {
  it('потребность — «Нужно по заказу»', () => {
    expect(PURCHASE_FIELD_LABELS.qtyExpected).toBe('Нужно по заказу');
  });

  it('заказ у поставщика — «Заказано поставщику»', () => {
    expect(PURCHASE_FIELD_LABELS.qtyOrdered).toBe('Заказано поставщику');
  });

  it('принятое — «Принято складом»', () => {
    expect(PURCHASE_FIELD_LABELS.qtyReceived).toBe('Принято складом');
  });

  it('ни одна подпись не носит прежних имён', () => {
    // «Фактическое количество» читалось как приход до всякой приёмки
    for (const old of ['Нужно количество', 'Фактическое количество', 'Количество к заказу']) {
      expect(Object.values(PURCHASE_FIELD_LABELS)).not.toContain(old);
    }
    expect(new Set(Object.values(PURCHASE_FIELD_LABELS)).size).toBe(3);
  });

  it('группы колонок по-прежнему делят потребность и факт', () => {
    // Разделение «что просил менеджер» и «что сделала закупка» — требование
    // документа 22.08, п. 12; переименование полей его не отменяет
    expect(PURCHASE_GROUPS.map((g) => g.key)).toEqual(['need', 'fact']);
  });
});

/**
 * СВОДКА ОДНОЙ СТРОКОЙ (правка 05.10, п. 6): «вместо больших счётчиков —
 * короткая строка». Нули не называются — кроме «всего».
 */
describe('сводка закупки строкой', () => {
  it('называет только ненулевое', () => {
    expect(purchaseSummaryLine({
      total: 3, notOrdered: 1, ordered: 2, inTransit: 1, arrived: 1, problems: [{}],
    })).toBe('Материалов 3 · не заказано 1 · заказано 2 · в пути 1 · пришло 1 · проблемы 1');
    expect(purchaseSummaryLine({
      total: 0, notOrdered: 0, ordered: 0, inTransit: 0, arrived: 0, problems: [],
    })).toBe('Материалов 0');
  });
});

/**
 * ФОРМА «НОВАЯ ЗАКУПКА» СПРАШИВАЕТ ОБА ЧИСЛА.
 *
 * Читается исходник: до 14.09 поле было ОДНО (правка 30.08, п. 8) и заполняло
 * обе колонки. Проверка по тексту ловит возврат к одному полю и потерю
 * обязательности потребности — без неё строка не закроется автоматически
 * никогда (`supply.missingPlan`). Модалка с 27.09 живёт своим файлом
 * (`AddPurchaseModal.jsx`) и покрыта рендер-тестом рядом; обязательность
 * полей считает `validatePurchaseForm`, поэтому сторож читает и его.
 */
const screenSrc = withoutJsComments(
  readFileSync(join(process.cwd(), 'src/erp/screens/purchasing/AddPurchaseModal.jsx'), 'utf8'),
);
const labelsSrc = withoutJsComments(
  readFileSync(join(process.cwd(), 'src/erp/screens/purchasing/purchaseLabels.js'), 'utf8'),
);

describe('форма новой закупки', () => {
  it('поля два — нужно по заказу и заказано поставщику; принятого в форме нет', () => {
    expect(screenSrc).toContain('PURCHASE_FIELD_LABELS.qtyExpected');
    expect(screenSrc).toContain('PURCHASE_FIELD_LABELS.qtyOrdered');
    // Принятое ведёт журнал приёмок — поля ввода у него быть не может
    expect(screenSrc).not.toContain('PURCHASE_FIELD_LABELS.qtyReceived');
    expect(screenSrc).not.toMatch(/qty_received/);
  });

  it('обязательна потребность, а не заказанное', () => {
    // Знаменатель приёмки и условие автозакрытия закупки — это qty_expected;
    // требовать вместо него заказанное значит запереть заведение строки до счёта
    expect(labelsSrc).toMatch(/source === 'purchase' && !\(Number\(form\.qty_expected\) > 0\)/);
    expect(labelsSrc).toContain('Укажите «${PURCHASE_FIELD_LABELS.qtyExpected}»');
  });

  it('потребность пишется из своего поля, а не из заказанного', () => {
    expect(screenSrc).toMatch(/qty_expected: form\.qty_expected === '' \? null : qtyExpected/);
    expect(screenSrc).toMatch(/qty_ordered: form\.qty_ordered === '' \? null : Number\(form\.qty_ordered\)/);
  });

  it('заказанное НЕ подставляется из потребности (правка 05.10, п. 6)', () => {
    // Подстановка 14.09 заполняла «заказано» до разговора с поставщиком:
    // строка выглядела оформленной (`supplyMaterialSummary.ordered`) раньше,
    // чем заказ случился
    expect(screenSrc).not.toContain('factTouched');
  });
});
