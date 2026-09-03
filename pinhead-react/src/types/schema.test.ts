import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сверка ручных типов ERP со схемой БД.
 *
 * `erp/types.ts` описывает таблицы руками. Пока это единственный источник,
 * про переименованную в миграции колонку приложение узнаёт в рантайме:
 * PostgREST молча не вернёт поле, и вместо ошибки экран покажет `undefined`.
 * Ровно так уже ловили `ORDER_LIST_SELECT` — отдельным сторожевым тестом.
 *
 * Здесь сверка идёт с МАШИННОЙ копией схемы (`database.generated.ts`).
 * Генерация не заменяет ручные типы: те описывают домен (вложенные деревья,
 * union-статусы), которого в схеме нет. Она даёт эталон для проверки.
 *
 * Тест читает исходники, а не импортирует типы: типы стираются при компиляции,
 * и во время выполнения их не существует. Тот же приём, что у
 * `serverPermissions.test.ts` и стража ключей хранилища.
 */

const SRC = join(process.cwd(), 'src');
const generated = readFileSync(join(SRC, 'types/database.generated.ts'), 'utf8');
const manual = readFileSync(join(SRC, 'erp/types.ts'), 'utf8');

/** Колонки таблицы из блока `Row: { … }` сгенерированного файла */
function columnsOf(table: string): string[] {
  const start = generated.indexOf(`      ${table}: {`);
  if (start < 0) throw new Error(`таблицы ${table} нет в схеме — переименована или удалена?`);
  const rowStart = generated.indexOf('Row: {', start);
  const rowEnd = generated.indexOf('        }', rowStart);
  return [...generated.slice(rowStart, rowEnd).matchAll(/^\s{10}(\w+)[?]?:/gm)].map((m) => m[1]);
}

/** Поля интерфейса из `erp/types.ts` */
function fieldsOf(iface: string): string[] {
  const start = manual.indexOf(`export interface ${iface} {`);
  if (start < 0) throw new Error(`интерфейса ${iface} нет в erp/types.ts`);
  const end = manual.indexOf('\n}', start);
  return [...manual.slice(start, end).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

/**
 * Пары «интерфейс ↔ таблица». Здесь только те, что клиент читает целиком
 * и по чьим полям строит экраны: расхождение в них видно людям.
 */
/**
 * Поля-ОТНОШЕНИЯ: приезжают вложенным `select`-ом PostgREST, колонками
 * в таблице не являются и потому в сверке не участвуют. Список явный,
 * а не «пропускать всё, что массив»: иначе опечатка в имени настоящей
 * колонки, случайно оказавшейся массивом, прошла бы молча.
 */
const EMBEDS: Record<string, string[]> = {
  ErpMaterial: ['suppliers'],
  // Заголовок заказа подмешивается вложенным select-ом при загрузке подряда —
  // таблица подряда показывает «№ и название», а не uuid заказа
  // Заголовок заказа и журнал перемещений подмешиваются вложенным select-ом
  // при загрузке подряда: таблица показывает «№ и название», а раскрытая строка —
  // передано/вернулось/принято. Отдельный запрос на строку был бы N+1
  ErpSubcontractOp: ['order', 'moves'],
};

const PAIRS: [string, string][] = [
  ['ErpOrder', 'erp_orders'],
  ['ErpOrderItem', 'erp_order_items'],
  ['ErpItemStage', 'erp_item_stages'],
  ['ErpDepartment', 'erp_departments'],
  ['ErpMaterial', 'erp_materials'],
  ['ErpCalendarSlot', 'erp_calendar_slots'],
  ['ErpTzDocument', 'erp_tz_documents'],
  ['ErpBypass', 'erp_bypasses'],
  ['ErpStageReport', 'erp_stage_reports'],
  ['ErpMaterialReceipt', 'erp_material_receipts'],
  ['ErpSubcontractMove', 'erp_subcontract_moves'],
  ['ErpSubcontractOp', 'erp_subcontracting'],
];

describe('ручные типы ERP не разошлись со схемой БД', () => {
  it.each(PAIRS)('%s описывает только существующие колонки %s', (iface, table) => {
    const cols = new Set(columnsOf(table));
    const embeds = new Set(EMBEDS[iface] ?? []);
    const extra = fieldsOf(iface).filter((f) => !cols.has(f) && !embeds.has(f));
    expect(extra, `${iface}: полей нет в таблице ${table} — ${extra.join(', ')}`).toEqual([]);
  });

  it('список отношений не разросся: каждое должно быть осознанным', () => {
    // Если поле добавили в ручной тип и вписали сюда «чтобы тест прошёл» —
    // сверка перестаёт работать. Пусть их пересчёт будет заметным действием.
    expect(Object.values(EMBEDS).flat()).toHaveLength(3);
  });

  it('схема содержит is_demo — колонку, на которой держится фильтр демо', () => {
    expect(columnsOf('erp_orders')).toContain('is_demo');
  });

  it('снимок схемы не протух: в нём есть таблицы последних волн', () => {
    // Если файл сгенерирован до миграции, эти таблицы в нём не появятся,
    // и вся сверка выше станет проверкой прошлого.
    for (const t of [
      'erp_calendar_slots', 'erp_tz_documents', 'erp_material_suppliers', 'erp_bypasses',
    ]) {
      expect(generated).toContain(`      ${t}: {`);
    }
  });
});

describe('ORDER_LIST_SELECT просит только существующие колонки', () => {
  /**
   * Списочный запрос перечисляет колонки этапа поимённо. Опечатка или
   * переименование в миграции превращались в молчаливый `undefined`
   * на экране очереди — PostgREST на неизвестную колонку в списке
   * отвечает ошибкой, но клиент её глотал тостом «не удалось загрузить».
   */
  const helpers = readFileSync(join(SRC, 'erp/store/orderHelpers.ts'), 'utf8');
  const listSelect = helpers.slice(
    helpers.indexOf('export const ORDER_LIST_SELECT'),
    helpers.indexOf('`;', helpers.indexOf('export const ORDER_LIST_SELECT')),
  );

  /** Колонки позиции, перечисленные в списочном запросе */
  function askedItemColumns(): string[] {
    const itemsBlock = listSelect.slice(
      listSelect.indexOf('items:erp_order_items ('),
      listSelect.indexOf('stages:erp_item_stages ('),
    );
    return itemsBlock
      .replace('items:erp_order_items (', '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => /^\w+$/.test(c));
  }

  it('колонки этапа в списочном запросе есть в erp_item_stages', () => {
    const stagesBlock = listSelect.slice(
      listSelect.indexOf('stages:erp_item_stages ('),
      listSelect.indexOf(')', listSelect.indexOf('stages:erp_item_stages (')),
    );
    const asked = stagesBlock
      .replace('stages:erp_item_stages (', '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => /^\w+$/.test(c));
    expect(asked.length).toBeGreaterThan(10);
    const cols = new Set(columnsOf('erp_item_stages'));
    const missing = asked.filter((c) => !cols.has(c));
    expect(missing, `нет в erp_item_stages: ${missing.join(', ')}`).toEqual([]);
  });

  it('колонки позиции в списочном запросе есть в erp_order_items', () => {
    const asked = askedItemColumns();
    const cols = new Set(columnsOf('erp_order_items'));
    const missing = asked.filter((c) => !cols.has(c));
    expect(missing, `нет в erp_order_items: ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * ВТОРАЯ СТОРОНА СВЕРКИ, и без неё первая ловит половину.
   *
   * Проверки выше односторонние: «в ручном типе нет лишнего» и «в запросе нет
   * несуществующего». Колонка, которую запрос ПРИВОЗИТ, а тип не описывает,
   * не нарушала ни одну из них — и три таких прожили с 16.08:
   * `packaging_size`, `sticker_place`, `marking_place`. Поля заполняет
   * менеджер, ТЗ показывает их цеху (`queue/TzBlock`), но для `tsc` их
   * не существует: файл на `.jsx`, и опечатка или переименование в миграции
   * дали бы пустое поле в ТЗ без единой ошибки.
   *
   * Проверяем именно то, что ЗАПРОШЕНО: колонок в таблице больше, чем нужно
   * клиенту, и требовать типизации всей схемы значило бы требовать лишнего.
   */
  it('каждая запрошенная колонка позиции описана в ErpOrderItem', () => {
    const typed = new Set(fieldsOf('ErpOrderItem'));
    const untyped = askedItemColumns().filter((c) => !typed.has(c));
    expect(
      untyped,
      `ORDER_LIST_SELECT везёт колонки, которых нет в ErpOrderItem: ${untyped.join(', ')} — `
      + 'для tsc их не существует, и переименование в миграции пройдёт молча',
    ).toEqual([]);
  });

  it('каждая запрошенная колонка этапа описана в ErpItemStage', () => {
    const stagesBlock = listSelect.slice(
      listSelect.indexOf('stages:erp_item_stages ('),
      listSelect.indexOf(')', listSelect.indexOf('stages:erp_item_stages (')),
    );
    const asked = stagesBlock
      .replace('stages:erp_item_stages (', '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => /^\w+$/.test(c));
    const typed = new Set(fieldsOf('ErpItemStage'));
    const untyped = asked.filter((c) => !typed.has(c));
    expect(untyped, `нет в ErpItemStage: ${untyped.join(', ')}`).toEqual([]);
  });
});
