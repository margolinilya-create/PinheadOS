import { describe, expect, it } from 'vitest';
import { latestDefining, withoutComments } from './migrations.testutil';
import { SKU_CARD_FIELD_LABELS, skuCardFieldLabel } from './skuCardFields';

/**
 * ИСТОРИЯ ВЕРСИЙ НАЗЫВАЕТ ТО, ЧТО ИЗМЕНИЛОСЬ, — а имена полей в неё кладёт
 * СЕРВЕР (`erp_sku_card_version`), не клиент. Значит перечень там один,
 * а подписи к нему другие, и разойтись они могут молча: показ продолжит
 * работать, просто вместо «Название лекал» человек прочтёт
 * «pattern_tech_name».
 *
 * Сторож спрашивает ОБЕ стороны. Колонка в триггере без подписи — английское
 * имя на экране; подпись без колонки — обещание истории, которой не будет.
 *
 * Определение берётся ПОСЛЕДНЕЙ миграцией, определяющей функцию
 * (`latestDefining`), а не файлом по имени: функции пересоздаются целиком,
 * и привязка к файлу сторожила бы файл, а не базу.
 */

const SQL = withoutComments(latestDefining('erp_sku_card_version'));

/** Имена, которые триггер кладёт в `changed_fields` */
function trackedFields(): string[] {
  return [...SQL.matchAll(/v_fields\s*:=\s*(?:v_fields\s*\|\||array_append\(\s*v_fields\s*,\s*)'([a-z_]+)'/g)]
    .map((m) => m[1]);
}

describe('подписи полей карточки SKU', () => {
  it('разбор триггера находит поля (иначе сторож зелен на чём угодно)', () => {
    expect(trackedFields().length).toBeGreaterThan(5);
  });

  it.each(trackedFields())('%s подписан по-русски', (field) => {
    const label = SKU_CARD_FIELD_LABELS[field];
    expect(label, `поле ${field} попадает в историю без подписи`).toBeTruthy();
    expect(label).toMatch(/[а-яА-Я]/);
  });

  it('лишних подписей нет: каждая описывает отслеживаемое поле', () => {
    const tracked = new Set(trackedFields());
    for (const field of Object.keys(SKU_CARD_FIELD_LABELS)) {
      expect(tracked.has(field), `${field} подписан, но в историю не попадает`).toBe(true);
    }
  });

  it('незнакомое имя показывается как есть, а не пропадает', () => {
    // Fail-open: пропавшая строка истории читалась бы как «правки не было»
    expect(skuCardFieldLabel('brand_new_column')).toBe('brand_new_column');
  });
});
