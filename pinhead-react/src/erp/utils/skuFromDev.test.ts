import { describe, expect, it } from 'vitest';
import type { ErpExperimental } from '../types';
import { matchByName, skuCodeFrom, skuDraftFromDev } from './skuFromDev';
import { latestDefining } from './migrations.testutil';

/**
 * Перенос финального пакета в каталог SKU.
 *
 * Смысл требования документа — «при следующем заказе этой модели
 * экспериментальный цех повторно не требуется». Проверяется здесь именно то,
 * из-за чего перенос нельзя делать «одной кнопкой»: часть полей каталога
 * пакет не содержит вовсе, и молча подставленный ноль дал бы артикул,
 * по которому заказ считается бесплатным.
 */

/**
 * `over` типизирован свободно намеренно: `Partial<ErpExperimental>` не принимает
 * объектный литерал из-за колонки `constructor` — она сталкивается
 * с `Object.prototype.constructor`. Это известная ловушка проекта, из-за неё
 * поле и приходит в код под именем `constructorName`.
 */
const dev = (over: Record<string, unknown> = {}): ErpExperimental => ({
  id: 'e1', order_id: 'o1', item_id: 'i1', tech_name: 'Худи оверсайз «Ромашка»',
  measurement_table: null, has_3d: false, constructor: null, technologist: null,
  due_date: null, comment: null, created_at: '', updated_at: '',
  ...over,
} as ErpExperimental);

describe('черновик артикула из разработки', () => {
  it('название, крой и категория выводятся из пакета и имени модели', () => {
    const { draft } = skuDraftFromDev(dev({
      final_package: { fit: 'Оверсайз', description: 'Плотное худи на флисе' },
    }));
    expect(draft.name).toBe('Худи оверсайз «Ромашка»');
    expect(draft.category).toBe('hoodies');
    expect(draft.fit).toBe('oversize');
    expect(draft.description).toContain('Плотное худи');
  });

  it('цена пошива и расход ткани НЕ выдумываются', () => {
    /**
     * Это прайс, а не описание модели: пакет их не содержит. Ноль в цене
     * означал бы артикул, по которому заказ считается бесплатным, — и заметили
     * бы это на счёте клиенту, а не при переносе
     */
    const { draft, gaps } = skuDraftFromDev(dev({ final_package: { description: 'x' } }));
    expect(draft.sewingPrice).toBeNull();
    expect(draft.mainFabricUsage).toBeNull();
    expect(gaps.map((g) => g.field)).toContain('sewingPrice');
    expect(gaps.map((g) => g.field)).toContain('mainFabricUsage');
  });

  it('категория, которую не угадать, попадает в перечень недостающего', () => {
    const { draft, gaps } = skuDraftFromDev(dev({ tech_name: 'Изделие 7' }));
    expect(draft.category).toBe('');
    expect(gaps.map((g) => g.field)).toContain('category');
  });

  it('ценовая вилка — подсказка, а не цена', () => {
    // Вилка это «сколько стоит изделие клиенту», а `sewingPrice` — стоимость
    // пошива в расчёте. Подставить одно вместо другого значит удвоить цену
    const { draft } = skuDraftFromDev(dev({
      price_min: 1500, price_max: 2400, final_package: {},
    }));
    expect(draft.priceHint).toEqual({ min: 1500, max: 2400 });
    expect(draft.sewingPrice).toBeNull();
  });

  it('размерный ряд читается и строкой, и списком', () => {
    expect(skuDraftFromDev(dev({ final_package: { size_row: 'S, M, L, XL' } })).draft.availableSizes)
      .toEqual(['S', 'M', 'L', 'XL']);
    expect(skuDraftFromDev(dev({ final_package: { size_row: null } })).draft.availableSizes)
      .toBeNull();
  });

  it('код артикула — латиница из названия', () => {
    expect(skuCodeFrom('Худи оверсайз «Ромашка»')).toBe('hudi-oversayz-romashka');
    expect(skuCodeFrom('Tee Regular 2.0')).toBe('tee-regular-2-0');
    // Пустое имя не даёт кода — он уйдёт в перечень недостающего
    expect(skuCodeFrom('')).toBe('');
  });
});

describe('сопоставление названий со справочником', () => {
  const FABRICS = [
    { code: 'footer3', name: 'Футер 3-нитка' },
    { code: 'kulirka', name: 'Кулирка' },
  ];

  it('находит по названию, не различая регистр и дефисы', () => {
    const r = matchByName(['футер 3 нитка', 'Кулирка'], FABRICS);
    expect(r.matched).toEqual(['footer3', 'kulirka']);
    expect(r.unmatched).toEqual([]);
  });

  it('ненайденное НЕ отбрасывает молча', () => {
    /**
     * Пропавшая ткань превратила бы «шьём из трёх» в «шьём из двух»,
     * и узнали бы об этом на первом заказе по новому артикулу
     */
    const r = matchByName(['Футер 3-нитка', 'Пике особое'], FABRICS);
    expect(r.matched).toEqual(['footer3']);
    expect(r.unmatched).toEqual(['Пике особое']);
  });
});

/**
 * СЕРВЕРНАЯ ПОЛОВИНА ПЕРЕНОСА.
 *
 * Каталог хранится ОДНОЙ строкой `app_config.sku_catalog`. Клиентское
 * «прочитать массив → дописать → записать обратно» оставляет окно, в котором
 * редактор SKU затирает новый артикул молча, поэтому запись идёт одним
 * оператором внутри функции. Сторож проверяет механизм, а не наличие слов.
 */
describe('erp_sku_from_dev — сервер', () => {
  const SQL = latestDefining('erp_sku_from_dev');

  it('право то же, что у редактора каталога', () => {
    expect(SQL).toMatch(/erp_has_permission\('catalog\.edit'\)/);
    expect(SQL).toMatch(/42501/);
  });

  it('переносится только готовая к серии и только один раз', () => {
    // Иначе гейт полноты пакета обходится с другой стороны, а у модели
    // появляются два артикула — два источника правды о ней
    expect(SQL).toMatch(/outcome[\s\S]{0,60}ready_for_serial/);
    expect(SQL).toMatch(/sku_code is not null[\s\S]{0,120}raise exception/);
  });

  it('обязательные поля каталога проверяются НА СЕРВЕРЕ', () => {
    // Форма сверки их спрашивает, но артикул с нулевой ценой ломает расчёт
    // заказа молча — сервер обязан отказать сам
    expect(SQL).toMatch(/sewingPrice[\s\S]{0,120}raise exception/);
    expect(SQL).toMatch(/category[\s\S]{0,150}raise exception/);
    expect(SQL).toMatch(/уже есть в каталоге/);
  });

  it('чтение и запись каталога — ОДНИМ оператором', () => {
    /**
     * Два запроса с окном между ними и есть тот случай, ради которого
     * функция заведена: редактор SKU, сохранивший каталог в этот момент,
     * затёр бы новый артикул, и заметили бы это через неделю
     */
    expect(SQL).toMatch(/insert into public\.app_config[\s\S]{0,300}on conflict \(key\) do update/);
  });

  it('`security definer` — осознанно, и объяснён в миграции', () => {
    // RLS `app_config` пускает только admin/director, а `catalog.edit` есть
    // и у руководителя производства: `invoker` дал бы «кнопка есть,
    // действие падает»
    expect(SQL).toMatch(/security definer/i);
    expect(SQL).toMatch(/revoke execute[\s\S]{0,80}from public, anon/);
  });
});
