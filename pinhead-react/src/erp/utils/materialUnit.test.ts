import { describe, it, expect } from 'vitest';
import type { ErpDictionaryItem } from '../types';
import { normalizeUnit, unitTracksRolls, unitShortLabel } from './materialUnit';

/**
 * Справочник в том виде, в каком он лежит на боевой базе 16.09: у значения
 * есть И КОД («кг»), И ИМЯ («Килограммы»), а признак «учитывается рулонами»
 * ставится в `meta`.
 */
const dict = (meta: Record<string, unknown> = { rolls: true }): ErpDictionaryItem[] => ([
  { id: '1', kind: 'unit', code: 'кг', name: 'Килограммы', sort_order: 1, active: true, meta },
  { id: '2', kind: 'unit', code: 'м', name: 'Метры', sort_order: 2, active: true, meta: {} },
  { id: '3', kind: 'unit', code: 'шт', name: 'Штуки', sort_order: 3, active: true, meta: {} },
  { id: '4', kind: 'supplier', code: 'кг', name: 'Кг-Текстиль', sort_order: 1, active: true, meta: { rolls: true } },
] as ErpDictionaryItem[]);

describe('normalizeUnit', () => {
  it.each([
    ['кг', 'кг'],
    ['КГ', 'кг'],
    [' Кг ', 'кг'],
    ['кг.', 'кг'],
    ['', ''],
    [null, ''],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeUnit(raw as string)).toBe(expected);
  });
});

describe('unitTracksRolls', () => {
  /**
   * ГЛАВНЫЙ СЛУЧАЙ, РАДИ КОТОРОГО УТИЛИТА И ЗАВЕДЕНА. На бою в одной колонке
   * лежат «кг» и «Килограммы» — то есть код и имя одного значения. Сравнение
   * строки не сработало бы на трёх строках из семи, и обязательное поле
   * рулонов не появилось бы там, где оно обязательно.
   */
  it.each([['кг'], ['Килограммы'], ['КИЛОГРАММЫ'], [' кг ']])(
    '«%s» — учёт рулонами', (unit) => {
      expect(unitTracksRolls(unit, dict())).toBe(true);
    },
  );

  it.each([['м'], ['Метры'], ['шт'], ['Штуки']])('«%s» рулонами не учитывается', (unit) => {
    expect(unitTracksRolls(unit, dict())).toBe(false);
  });

  /**
   * Признак СТРОГО `true`. У значений без него `meta` пустой объект, и любое
   * «не false» объявило бы рулонными все единицы разом — то есть потребовало
   * бы число рулонов при приёмке бирок.
   */
  it('единица без признака в справочнике рулонами не учитывается', () => {
    expect(unitTracksRolls('кг', dict({}))).toBe(false);
    expect(unitTracksRolls('кг', dict({ rolls: 'да' }))).toBe(false);
    expect(unitTracksRolls('кг', dict({ rolls: false }))).toBe(false);
  });

  /**
   * Справочник — подсказка, а не ограничение: закупщик может набрать единицу
   * руками. Для уже существующих строк это лечат синонимы, и только они.
   */
  it('набранный руками синоним килограммов узнаётся без справочника', () => {
    expect(unitTracksRolls('kg', [])).toBe(true);
    expect(unitTracksRolls('Килограмм', [])).toBe(true);
  });

  it('незнакомая единица не блокирует приёмку — fail-open', () => {
    expect(unitTracksRolls('бухта', dict())).toBe(false);
    expect(unitTracksRolls('', dict())).toBe(false);
    expect(unitTracksRolls(null, dict())).toBe(false);
    expect(unitTracksRolls('кг', null)).toBe(true); // синоним, справочника нет
  });

  /**
   * Вид справочника участвует в отборе: у поставщика может быть имя,
   * совпадающее с кодом единицы, и без фильтра по `kind` бирки внезапно
   * стали бы рулонными.
   */
  it('значение ЧУЖОГО вида справочника не считается единицей', () => {
    const onlySupplier = dict().filter((d) => d.kind === 'supplier');
    // Совпадение по коду есть, но это поставщик — решают синонимы, а не он
    expect(unitTracksRolls('Кг-Текстиль', onlySupplier)).toBe(false);
  });
});

describe('unitShortLabel', () => {
  it('подпись поля не зависит от того, код или имя выбрал закупщик', () => {
    expect(unitShortLabel('Килограммы', dict())).toBe('кг');
    expect(unitShortLabel('кг', dict())).toBe('кг');
  });

  it('незнакомая единица показывается как есть', () => {
    expect(unitShortLabel('бухта', dict())).toBe('бухта');
  });

  it('пустая единица не даёт пустой подписи с запятой', () => {
    expect(unitShortLabel(null, dict())).toBe('');
  });
});
