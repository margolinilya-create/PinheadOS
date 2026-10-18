import { describe, it, expect } from 'vitest';
import type { ZoneDefinition } from '../../../types/catalog';
import {
  addZone, addZoneError, defaultTzRowLabel, moveZone, setZoneCategories, setZoneField,
  sortedZones, toggleZoneActive, zoneErrors,
} from './zonesEdit';

const ZONES: ZoneDefinition[] = [
  { id: 'back', name: 'Спина', forCategories: null, sortOrder: 2 },
  { id: 'front', name: 'Грудь', forCategories: null, sortOrder: 1 },
  { id: 'hood', name: 'Капюшон', forCategories: ['hoodies'], requiresHood: true, sortOrder: 3 },
];

describe('sortedZones', () => {
  it('по sortOrder, без него — в конце; исходный список не меняется', () => {
    const list = [{ id: 'x', name: 'Икс' }, ...ZONES];
    const before = JSON.stringify(list);
    expect(sortedZones(list).map((z) => z.id)).toEqual(['front', 'back', 'hood', 'x']);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('addZone / addZoneError', () => {
  it('новая зона — в конце, для всех категорий, в подборе', () => {
    const next = addZone(ZONES, { id: 'pocket', name: '  Карман ' });
    expect(next).toHaveLength(4);
    expect(next[3]).toEqual({ id: 'pocket', name: 'Карман', forCategories: null, sortOrder: 4 });
    expect(ZONES).toHaveLength(3);
  });

  it('id — по ZONE_ID_RE, уникален; название — непустое, уникально без регистра, ≤ 200', () => {
    expect(addZoneError(ZONES, '', 'Карман')).toMatch(/id/);
    expect(addZoneError(ZONES, 'Pocket', 'Карман')).toMatch(/латиниц/);
    expect(addZoneError(ZONES, 'a'.repeat(64), 'Карман')).toMatch(/латиниц/);
    expect(addZoneError(ZONES, 'front', 'Карман')).toBe('Зона с id «front» уже есть');
    expect(addZoneError(ZONES, 'pocket', '  ')).toBe('Введите название зоны');
    expect(addZoneError(ZONES, 'pocket', ' грудь ')).toBe('Зона «Грудь» уже есть — название должно отличаться');
    expect(addZoneError(ZONES, 'pocket', 'К'.repeat(201))).toMatch(/200/);
    expect(addZoneError(ZONES, 'pocket', 'Карман')).toBeNull();
    expect(addZoneError(ZONES, 'a'.repeat(63), 'Карман')).toBeNull();
  });
});

describe('setZoneField', () => {
  it('строка ТЗ: код ставится, пустое значение убирает ключ (сервер не принимает null)', () => {
    const withRow = setZoneField(ZONES, 'hood', { tz_row: 'hood_l' });
    expect(withRow.find((z) => z.id === 'hood')?.tz_row).toBe('hood_l');
    const cleared = setZoneField(withRow, 'hood', { tz_row: '' });
    expect('tz_row' in (cleared.find((z) => z.id === 'hood') as object)).toBe(false);
  });

  it('флажки капюшона и кармана; чужие зоны — те же объекты', () => {
    const next = setZoneField(ZONES, 'front', { requiresPocket: true });
    expect(next.find((z) => z.id === 'front')?.requiresPocket).toBe(true);
    expect(next.find((z) => z.id === 'back')).toBe(ZONES[0]);
  });
});

describe('setZoneCategories', () => {
  it('«Все» — null; снять одну из всех — остальные; вернуть последнюю — снова null', () => {
    const all = setZoneCategories(ZONES, 'front', 'tshirts', ['tshirts', 'hoodies']);
    expect(all.find((z) => z.id === 'front')?.forCategories).toEqual(['hoodies']);
    const back = setZoneCategories(all, 'front', 'tshirts', ['tshirts', 'hoodies']);
    expect(back.find((z) => z.id === 'front')?.forCategories).toBeNull();
  });
});

describe('moveZone', () => {
  it('меняет местами с соседом и пересчитывает sortOrder 1..n', () => {
    const next = moveZone(ZONES, 'back', -1);
    expect(next.map((z) => [z.id, z.sortOrder])).toEqual([['back', 1], ['front', 2], ['hood', 3]]);
  });

  it('за край не уходит', () => {
    expect(moveZone(ZONES, 'front', -1).map((z) => z.id)).toEqual(['front', 'back', 'hood']);
    expect(moveZone(ZONES, 'hood', 1).map((z) => z.id)).toEqual(['front', 'back', 'hood']);
  });
});

describe('toggleZoneActive', () => {
  it('снять — active: false; вернуть — ключ убран (зона снова в подборе)', () => {
    const off = toggleZoneActive(ZONES, 'back');
    expect(off.find((z) => z.id === 'back')?.active).toBe(false);
    const on = toggleZoneActive(off, 'back');
    expect('active' in (on.find((z) => z.id === 'back') as object)).toBe(false);
  });
});

describe('zoneErrors', () => {
  it('сохранённая зона: переименовать нельзя, удалить нельзя', () => {
    const renamed = ZONES.map((z) => (z.id === 'front' ? { ...z, name: 'Грудь (перед)' } : z));
    expect(zoneErrors(renamed, ZONES)).toEqual([
      { id: 'front', message: 'Название сохранённой зоны «Грудь» менять нельзя — снимите её и добавьте новую' },
    ]);
    expect(zoneErrors(ZONES.slice(1), ZONES)).toEqual([
      { id: 'back', message: 'Зону «Спина» нельзя удалить — снимите её с подбора' },
    ]);
  });

  it('дубли id и названия (без регистра), пустое название, неверная строка ТЗ', () => {
    const list: ZoneDefinition[] = [
      ...ZONES,
      { id: 'front', name: 'Грудь 2' },
      { id: 'pocket', name: ' спина ' },
      { id: 'leg', name: '' },
      { id: 'side', name: 'Бок', tz_row: 'Полочка' },
    ];
    const msgs = zoneErrors(list, ZONES).map((e) => e.message);
    expect(msgs).toContain('id «front» повторяется');
    expect(msgs).toContain('Название «спина» повторяется');
    expect(msgs).toContain('Введите название зоны «leg»');
    expect(msgs).toContain('Строка ТЗ зоны «Бок» неизвестна — выберите из списка');
  });

  it('верный справочник — без ошибок', () => {
    expect(zoneErrors(ZONES, ZONES)).toEqual([]);
    expect(zoneErrors(addZone(ZONES, { id: 'pocket', name: 'Карман' }), ZONES)).toEqual([]);
  });
});

describe('defaultTzRowLabel', () => {
  it('подпись строки по умолчанию: по id зоны, иначе «Другое»', () => {
    expect(defaultTzRowLabel('front')).toBe('по умолчанию: Полочка');
    expect(defaultTzRowLabel('hood')).toBe('по умолчанию: Другое');
    expect(defaultTzRowLabel('новая')).toBe('по умолчанию: Другое');
  });
});
