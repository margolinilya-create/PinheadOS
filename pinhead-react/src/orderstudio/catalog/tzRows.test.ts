import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TZ_ROW_BY_ZONE, TZ_MATRIX_ROWS, TZ_ROW_CODES, TZ_ROW_LABELS, ZONE_ID_RE, asTzRow, tzRowOfArea, tzRowOfZone,
  zoneIdByName, zoneOfPrint,
} from './tzRows';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import { AREA_ID_RE } from '../design/limits';

describe('tzRows — строки матрицы ТЗ (К8)', () => {
  it('9 строк матрицы и «Другое»; коды уникальны, у каждого подпись', () => {
    expect(TZ_MATRIX_ROWS).toHaveLength(9);
    expect(TZ_ROW_CODES).toEqual([...TZ_MATRIX_ROWS, 'other']);
    expect(new Set(TZ_ROW_CODES).size).toBe(TZ_ROW_CODES.length);
    for (const c of TZ_ROW_CODES) expect(TZ_ROW_LABELS[c]).toBeTruthy();
    expect(new Set(Object.values(TZ_ROW_LABELS)).size).toBe(TZ_ROW_CODES.length);
  });

  it('у каждой зоны ZONES_CATALOG_DEFAULT есть строка по умолчанию из перечня', () => {
    for (const z of ZONES_CATALOG_DEFAULT) {
      expect(DEFAULT_TZ_ROW_BY_ZONE[z.id], z.id).toBeDefined();
      expect(TZ_ROW_CODES).toContain(DEFAULT_TZ_ROW_BY_ZONE[z.id]);
    }
  });

  it('умолчания: перед, спина, рукава, карман; капюшон — «Другое» (решение 3)', () => {
    expect(DEFAULT_TZ_ROW_BY_ZONE).toMatchObject({ front: 'front', back: 'back', 'sleeve-l': 'sleeve_l', 'sleeve-r': 'sleeve_r', pocket: 'pocket', hood: 'other' });
  });

  it('ZONE_ID_RE совпадает с id всех зон ZONES_CATALOG_DEFAULT и с AREA_ID_RE', () => {
    for (const z of ZONES_CATALOG_DEFAULT) expect(ZONE_ID_RE.test(z.id), z.id).toBe(true);
    expect(ZONE_ID_RE.source).toBe(AREA_ID_RE.source);
  });

  it('ZONE_ID_RE: pants-front и side_a — да; кириллица и 64 символа — нет', () => {
    expect(ZONE_ID_RE.test('pants-front')).toBe(true);
    expect(ZONE_ID_RE.test('side_a')).toBe(true);
    expect(ZONE_ID_RE.test('грудь')).toBe(false);
    expect(ZONE_ID_RE.test('a'.repeat(63))).toBe(true);
    expect(ZONE_ID_RE.test('a'.repeat(64))).toBe(false);
    expect(ZONE_ID_RE.test('-front')).toBe(false);
  });

  it('asTzRow принимает только перечень', () => {
    expect(asTzRow('front_l')).toBe('front_l');
    expect(asTzRow('Полочка')).toBeNull();
    expect(asTzRow(undefined)).toBeNull();
  });

  it('tzRowOfZone: своя строка → умолчание по id → «Другое»', () => {
    expect(tzRowOfZone({ id: 'hood', tz_row: 'hood_l' })).toBe('hood_l');
    expect(tzRowOfZone({ id: 'hood', tz_row: 'мусор' })).toBe('other');
    expect(tzRowOfZone({ id: 'sleeve-l' })).toBe('sleeve_l');
    expect(tzRowOfZone({ id: 'new-zone' })).toBe('other');
    expect(tzRowOfZone(undefined)).toBe('other');
  });

  it('tzRowOfArea: зона флэта → справочник зон → умолчание → «Другое»', () => {
    const zones = [{ id: 'front', tz_row: 'front' }, { id: 'hood', tz_row: 'hood_r' }];
    expect(tzRowOfArea({ zone_id: 'front', tz_row: 'front_l' }, zones)).toBe('front_l');
    expect(tzRowOfArea({ zone_id: 'hood' }, zones)).toBe('hood_r');
    expect(tzRowOfArea({ zone_id: 'pocket' }, zones)).toBe('pocket');
    expect(tzRowOfArea({ zone_id: null }, zones)).toBe('other');
    expect(tzRowOfArea({ zone_id: null, tz_row: 'back' }, zones)).toBe('back');
  });

  it('zoneIdByName: код зоны справочника по названию (без регистра и пробелов); нет или код не по формату — null', () => {
    const zones = [{ id: 'front', name: 'Грудь' }, { id: 'pocket', name: 'Карман' }, { id: 'Bad Id', name: 'Плечо' }];
    expect(zoneIdByName(' грудь ', zones)).toBe('front');
    expect(zoneIdByName('Карман', zones)).toBe('pocket');
    expect(zoneIdByName('Плечо', zones)).toBeNull();
    expect(zoneIdByName('Где-то', zones)).toBeNull();
    expect(zoneIdByName('', zones)).toBeNull();
    expect(zoneIdByName('Грудь', undefined)).toBeNull();
  });

  it('zoneOfPrint: по zone_id (справочник или умолчание кода), без кода — по названию', () => {
    const zones = [{ id: 'chest-pocket', name: 'Нагрудный карман', tz_row: 'pocket' }, { id: 'front', name: 'Грудь' }];
    expect(tzRowOfZone(zoneOfPrint({ zone: 'Переименовали', zone_id: 'chest-pocket' }, zones))).toBe('pocket');
    // кода нет в справочнике — строка по умолчанию кода, имя не читается
    expect(tzRowOfZone(zoneOfPrint({ zone: 'Грудь', zone_id: 'pocket' }, zones))).toBe('pocket');
    expect(tzRowOfZone(zoneOfPrint({ zone: 'грудь', zone_id: null }, zones))).toBe('front');
    expect(zoneOfPrint({ zone: '', zone_id: null }, zones)).toBeUndefined();
  });
});
