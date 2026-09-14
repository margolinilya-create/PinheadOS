import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PURCHASE_FIELD_LABELS, PURCHASE_GROUPS } from './purchaseLabels';
import { withoutJsComments } from '../../utils/migrations.testutil';

/**
 * ДВА КОЛИЧЕСТВА ЗАКУПКИ НАЗЫВАЮТСЯ ПО-РАЗНОМУ (правка заказчика 14.09, п. 2).
 *
 * Документ: «количество из листа закупки отображается так, что плановую
 * потребность и фактически заказанное количество легко перепутать».
 *
 * Почему сторож поимённый, а не «подписи различны». Переименование задевает
 * ОБЕ величины: имя «Количество к заказу» до 14.09 носил `qty_ordered`, и
 * правка, сделанная наполовину, оставила бы на экране два поля с одним именем
 * и разным смыслом — то самое, на что жалуется документ. Проверка «лишь бы
 * не совпадали» прошла бы и на половинной правке, и на откате.
 *
 * Значения подписей — решение владельца, поэтому закреплены дословно.
 */

describe('подписи количеств закупки', () => {
  it('потребность производства называется «Количество к заказу»', () => {
    expect(PURCHASE_FIELD_LABELS.qtyExpected).toBe('Количество к заказу');
  });

  it('факт заказа у поставщика называется «Фактическое количество»', () => {
    expect(PURCHASE_FIELD_LABELS.qtyOrdered).toBe('Фактическое количество');
  });

  it('ни одна подпись не носит прежнее имя соседки', () => {
    // «Нужно количество» ушло целиком: именно его документ просил заменить
    expect(Object.values(PURCHASE_FIELD_LABELS)).not.toContain('Нужно количество');
    expect(PURCHASE_FIELD_LABELS.qtyExpected).not.toBe(PURCHASE_FIELD_LABELS.qtyOrdered);
  });

  it('группы колонок по-прежнему делят потребность и факт', () => {
    // Разделение «что просил менеджер» и «что сделала закупка» — требование
    // документа 22.08, п. 12; переименование полей его не отменяет
    expect(PURCHASE_GROUPS.map((g) => g.key)).toEqual(['need', 'fact']);
  });
});

/**
 * ФОРМА «НОВАЯ ЗАКУПКА» СПРАШИВАЕТ ОБА ЧИСЛА.
 *
 * Читается исходник: до 14.09 поле было ОДНО (правка 30.08, п. 8) и заполняло
 * обе колонки, а модалка не покрыта ни одним рендер-тестом. Проверка по тексту
 * ловит возврат к одному полю и потерю обязательности потребности — без неё
 * строка не закроется автоматически никогда (`supply.missingPlan`).
 */
const screenSrc = withoutJsComments(
  readFileSync(join(process.cwd(), 'src/erp/screens/FabricPurchasing.jsx'), 'utf8'),
);

describe('форма новой закупки', () => {
  it('поля два — и потребность, и факт', () => {
    expect(screenSrc).toContain('PURCHASE_FIELD_LABELS.qtyExpected');
    expect(screenSrc).toContain('PURCHASE_FIELD_LABELS.qtyOrdered');
  });

  it('обязательна потребность, а не факт', () => {
    // Знаменатель приёмки и условие автозакрытия закупки — это qty_expected;
    // требовать вместо него факт значит запереть заведение строки до счёта
    expect(screenSrc).toMatch(/!form\.qty_expected \|\| Number\(form\.qty_expected\) <= 0/);
    expect(screenSrc).toContain('Укажите «${PURCHASE_FIELD_LABELS.qtyExpected}»');
  });

  it('потребность пишется из своего поля, а не из факта', () => {
    // Прежняя редакция писала `qty_expected: form.qty_ordered === '' ? …`,
    // то есть одно число в две колонки
    expect(screenSrc).toMatch(/qty_expected: form\.qty_expected === '' \? null : qtyExpected/);
    expect(screenSrc).toMatch(/qty_ordered: form\.qty_ordered === '' \? null : Number\(form\.qty_ordered\)/);
  });

  it('факт едет за потребностью, пока человек его не тронул', () => {
    // Скорость ввода правки 30.08 сохраняется: обычно заказывают ровно
    // столько, сколько нужно. Признак — состояние, а не сравнение значений
    expect(screenSrc).toContain('factTouched');
    expect(screenSrc).toContain('setFactTouched(true)');
  });
});
