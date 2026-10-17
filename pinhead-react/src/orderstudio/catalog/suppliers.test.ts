import { describe, it, expect } from 'vitest';
import {
  defaultSupplier, supplierForFabric, findPaletteColor, offeredColors, fabricSupplierNamesOf,
  setDefaultSupplier, bindFabricName, updateColor, updateColorAt, addColor, addGroup, addSupplier,
  validateSuppliers, isValidHex, codeOwner,
} from './suppliers';
import { SUPPLIERS_SEED } from './seeds';
import type { Supplier } from './types';

const fabric = (supplier: string) => ({ supplier });

/** Палитра поставщика «Тонитекс» без цветов — привязана к имени ткани «ТониТекс» */
const withTonitex = (): Supplier[] => [
  ...SUPPLIERS_SEED,
  {
    id: 'tonitex', name: 'Тонитекс', isDefault: false, fabricSupplierNames: ['ТониТекс'], active: true,
    palette: { groups: [], colors: [] },
  },
];

describe('поставщик ткани → палитра', () => {
  it('Медас — Медастекс по привязке', () => {
    expect(supplierForFabric(fabric('Медас'), SUPPLIERS_SEED)?.id).toBe('medastex');
  });

  it('непривязанный поставщик — палитра по умолчанию (Коттонпром)', () => {
    expect(supplierForFabric(fabric('ТД Коттон'), SUPPLIERS_SEED)?.id).toBe('cottonprom');
    expect(supplierForFabric(fabric(''), SUPPLIERS_SEED)?.id).toBe('cottonprom');
    expect(defaultSupplier(SUPPLIERS_SEED)?.id).toBe('cottonprom');
  });

  it('ткани нет — null (палитру не трогать)', () => {
    expect(supplierForFabric(null, SUPPLIERS_SEED)).toBeNull();
    expect(supplierForFabric(undefined, SUPPLIERS_SEED)).toBeNull();
  });

  it('новая привязка работает без правки кода', () => {
    expect(supplierForFabric(fabric('ТониТекс'), withTonitex())?.id).toBe('tonitex');
  });

  it('снятый с продажи поставщик не привязывает — палитра по умолчанию', () => {
    const list = SUPPLIERS_SEED.map((s) => (s.id === 'medastex' ? { ...s, active: false } : s));
    expect(supplierForFabric(fabric('Медас'), list)?.id).toBe('cottonprom');
  });

  it('пустой список — null', () => {
    expect(supplierForFabric(fabric('Медас'), [])).toBeNull();
    expect(defaultSupplier([])).toBeNull();
  });
});

describe('findPaletteColor — сначала палитра ткани, затем глобально', () => {
  const medas = SUPPLIERS_SEED[0];
  it('код своей палитры', () => {
    expect(findPaletteColor('01-01', SUPPLIERS_SEED, medas)?.name).toBe('Белый');
  });

  it('«5001» у ткани Медас — из Коттонпрома (живые данные)', () => {
    const hit = findPaletteColor('5001', SUPPLIERS_SEED, medas);
    expect(hit?.name).toBe('Белый');
    expect(hit?.hex).toBe('#FFFFFF');
  });

  it('свободный текст — null', () => {
    expect(findPaletteColor('розовый', SUPPLIERS_SEED, medas)).toBeNull();
    expect(findPaletteColor('', SUPPLIERS_SEED)).toBeNull();
  });

  it('снятый цвет находится — заказ показывает его как есть', () => {
    const list = updateColor(SUPPLIERS_SEED, 'medastex', '01-01', { active: false });
    expect(findPaletteColor('01-01', list)?.active).toBe(false);
  });

  it('палитра ткани побеждает, если код повторился (данные мимо редактора)', () => {
    const list = updateColor(SUPPLIERS_SEED, 'cottonprom', '5001', { code: '01-01', name: 'Чужой' });
    expect(findPaletteColor('01-01', list, list[1])?.name).toBe('Чужой');
    expect(findPaletteColor('01-01', list, list[0])?.name).toBe('Белый');
  });
});

describe('offeredColors — в заказ только активные', () => {
  it('снятые не предлагаются', () => {
    const list = updateColor(SUPPLIERS_SEED, 'medastex', '01-01', { active: false });
    const codes = offeredColors(list[0]).map((c) => c.code);
    expect(codes).not.toContain('01-01');
    expect(codes).toContain('01-02');
  });
});

describe('правки справочника — без мутаций', () => {
  it('палитра по умолчанию ровно одна', () => {
    const next = setDefaultSupplier(SUPPLIERS_SEED, 'medastex');
    expect(next.filter((s) => s.isDefault).map((s) => s.id)).toEqual(['medastex']);
    expect(SUPPLIERS_SEED[1].isDefault).toBe(true);
  });

  it('привязка имени ткани переносится, а не двоится', () => {
    const list = withTonitex();
    const next = bindFabricName(list, 'tonitex', 'Медас', true);
    expect(next.find((s) => s.id === 'tonitex')?.fabricSupplierNames).toEqual(['ТониТекс', 'Медас']);
    expect(next.find((s) => s.id === 'medastex')?.fabricSupplierNames).toEqual([]);
    const off = bindFabricName(next, 'tonitex', 'Медас', false);
    expect(off.find((s) => s.id === 'tonitex')?.fabricSupplierNames).toEqual(['ТониТекс']);
    expect(list.find((s) => s.id === 'medastex')?.fabricSupplierNames).toEqual(['Медас']);
  });

  it('добавить цвет, группу, поставщика', () => {
    const a = addColor(SUPPLIERS_SEED, 'medastex', { code: 'M-1', name: 'Мятный', hex: '#AAFFCC', group: '' });
    const added = a[0].palette.colors.at(-1);
    expect(added).toEqual({ code: 'M-1', name: 'Мятный', hex: '#AAFFCC', group: '', active: true });
    const g = addGroup(a, 'medastex', 'Новые');
    expect(g[0].palette.groups.at(-1)?.label).toBe('Новые');
    expect(new Set(g[0].palette.groups.map((x) => x.id)).size).toBe(g[0].palette.groups.length);
    const s = addSupplier(g, 'Рутекс');
    expect(s.at(-1)).toMatchObject({ name: 'Рутекс', isDefault: false, active: true, fabricSupplierNames: [] });
    expect(s.at(-1)?.id).toMatch(/^[a-z0-9-]+$/);
    expect(SUPPLIERS_SEED[0].palette.colors.some((c) => c.code === 'M-1')).toBe(false);
  });

  it('правка цвета по месту — для нового цвета с пустым кодом', () => {
    const a = addColor(SUPPLIERS_SEED, 'medastex', { code: '', name: '', hex: '#000000', group: '' });
    const i = a[0].palette.colors.length - 1;
    const b = updateColorAt(a, 'medastex', i, { code: 'M-2' });
    expect(b[0].palette.colors[i].code).toBe('M-2');
    expect(a[0].palette.colors[i].code).toBe('');
  });

  it('имена поставщиков тканей — без повторов и пустых, по алфавиту', () => {
    expect(fabricSupplierNamesOf([fabric('Медас'), fabric('ТД Коттон'), fabric('Медас'), fabric(' ')])).toEqual(['Медас', 'ТД Коттон']);
  });
});

describe('проверка справочника перед сохранением', () => {
  it('сиды — без ошибок; непривязанные имена — предупреждение', () => {
    const v = validateSuppliers(SUPPLIERS_SEED, ['Медас', 'ТД Коттон']);
    expect(v.errors).toEqual([]);
    expect(v.unbound).toEqual(['ТД Коттон']);
  });

  it('hex строго #RRGGBB', () => {
    expect(isValidHex('#A1b2C3')).toBe(true);
    expect(isValidHex('#fff')).toBe(false);
    expect(isValidHex('#fff" onload=alert(1)')).toBe(false);
    const list = updateColor(SUPPLIERS_SEED, 'medastex', '01-01', { hex: 'red' });
    expect(validateSuppliers(list, []).errors.join(' ')).toMatch(/01-01/);
  });

  it('дубль кода по всем палитрам', () => {
    const list = addColor(SUPPLIERS_SEED, 'medastex', { code: '5001', name: 'Дубль', hex: '#000000', group: '' });
    const v = validateSuppliers(list, []);
    expect(v.duplicateCodes).toEqual(['5001']);
    expect(v.errors.join(' ')).toMatch(/5001/);
    expect(codeOwner(SUPPLIERS_SEED, '5001')?.name).toBe('Коттонпром');
  });

  it('палитра по умолчанию — ровно одна', () => {
    const none = SUPPLIERS_SEED.map((s) => ({ ...s, isDefault: false }));
    expect(validateSuppliers(none, []).errors.join(' ')).toMatch(/по умолчанию/);
  });

  it('одно имя ткани — не больше одной палитры', () => {
    const list = SUPPLIERS_SEED.map((s) => ({ ...s, fabricSupplierNames: ['Медас'] }));
    expect(validateSuppliers(list, ['Медас']).errors.join(' ')).toMatch(/Медас/);
  });

  it('пустой код или название поставщика — ошибка', () => {
    const list = addColor(SUPPLIERS_SEED, 'medastex', { code: ' ', name: 'x', hex: '#000000', group: '' });
    expect(validateSuppliers(list, []).errors.length).toBeGreaterThan(0);
    const noName = SUPPLIERS_SEED.map((s, i) => (i === 0 ? { ...s, name: '' } : s));
    expect(validateSuppliers(noName, []).errors.length).toBeGreaterThan(0);
  });
});
