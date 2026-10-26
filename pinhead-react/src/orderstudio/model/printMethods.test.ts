import { describe, it, expect } from 'vitest';
import {
  METHOD_LABELS, METHOD_ORDER, METHOD_TO_TECH, PRINT_METHOD_PROFILES, TECH_TO_METHOD,
  allowedMethods, defaultMethod, methodAllowedInZone, methodSizeIssue, printMethodProfile, resolveMethod,
} from './printMethods';
import { SALES_PRINT_METHODS } from './types';
import { METHOD_LABELS as SCREEN_LABELS, METHOD_ORDER as SCREEN_ORDER } from '../screens/labels';

describe('единый модуль техник (веха 5а, задача 1)', () => {
  it('профиль есть у каждой из 8 техник Order, подпись — из METHOD_LABELS', () => {
    expect(Object.keys(PRINT_METHOD_PROFILES).sort()).toEqual([...SALES_PRINT_METHODS].sort());
    for (const m of SALES_PRINT_METHODS) {
      expect(PRINT_METHOD_PROFILES[m].id).toBe(m);
      expect(PRINT_METHOD_PROFILES[m].label).toBe(METHOD_LABELS[m]);
      expect(PRINT_METHOD_PROFILES[m].short.length).toBeGreaterThan(0);
    }
    expect([...METHOD_ORDER].sort()).toEqual([...SALES_PRINT_METHODS].sort());
  });

  it('экраны читают подписи и порядок отсюда же (одно место)', () => {
    expect(SCREEN_LABELS).toBe(METHOD_LABELS);
    expect(SCREEN_ORDER).toBe(METHOD_ORDER);
  });

  it('DPI как в дизайн-мейкере (ответ владельца 17.10): DTF, шелкография, DTG, флекс — 300/150', () => {
    for (const m of ['dtf', 'silkscreen', 'dtg', 'heat_transfer'] as const) {
      expect(PRINT_METHOD_PROFILES[m].dpi).toEqual({ good: 300, min: 150 });
      expect(PRINT_METHOD_PROFILES[m].detail).toBeUndefined();
    }
  });

  it('вышивка — подсказка о детали (линия 1 мм, текст 4 мм), без DPI', () => {
    expect(PRINT_METHOD_PROFILES.embroidery.detail).toEqual({ minLineMm: 1, minTextMm: 4 });
    expect(PRINT_METHOD_PROFILES.embroidery.dpi).toBeUndefined();
  });

  it('сублимация, шевроны и прочее — без контроля DPI и детали', () => {
    for (const m of ['sublimation', 'patch', 'other'] as const) {
      expect(PRINT_METHOD_PROFILES[m].dpi).toBeUndefined();
      expect(PRINT_METHOD_PROFILES[m].detail).toBeUndefined();
    }
  });

  it('Pantone — у плашечных техник, не у растровых', () => {
    expect(PRINT_METHOD_PROFILES.silkscreen).toMatchObject({ colorMode: 'spot', pantone: true });
    expect(PRINT_METHOD_PROFILES.embroidery).toMatchObject({ colorMode: 'spot', pantone: true });
    expect(PRINT_METHOD_PROFILES.dtf).toMatchObject({ colorMode: 'cmyk', pantone: false });
    expect(PRINT_METHOD_PROFILES.dtg).toMatchObject({ colorMode: 'cmyk', pantone: false });
  });

  it('printMethodProfile: неизвестная техника — шелкография', () => {
    expect(printMethodProfile('dtg').id).toBe('dtg');
    expect(printMethodProfile(undefined).id).toBe('silkscreen');
    expect(printMethodProfile('nope' as never).id).toBe('silkscreen');
  });
});

describe('техники визарда ↔ техники Order', () => {
  it('пять техник визарда переводятся туда и обратно без потерь', () => {
    for (const [tech, method] of Object.entries(TECH_TO_METHOD)) {
      expect(METHOD_TO_TECH[method]).toBe(tech);
    }
    expect(Object.keys(TECH_TO_METHOD).sort()).toEqual(['dtf', 'dtg', 'embroidery', 'flex', 'screen']);
  });

  it('у сублимации, шевронов и прочего техники визарда нет', () => {
    expect(METHOD_TO_TECH.sublimation).toBeUndefined();
    expect(METHOD_TO_TECH.patch).toBeUndefined();
    expect(METHOD_TO_TECH.other).toBeUndefined();
  });
});

describe('техника в зоне (решение 8)', () => {
  const rules = (allowedTechs: string[] | null, allowedZoneTechs: Record<string, string[]> | null = null) =>
    ({ allowedTechs, allowedZoneTechs });

  it('methodAllowedInZone: нет списка — допустимы все', () => {
    expect(methodAllowedInZone(undefined, 'dtf')).toBe(true);
    expect(methodAllowedInZone({ methods: [] }, 'dtf')).toBe(true);
    expect(methodAllowedInZone({ methods: ['dtf'] }, 'dtf')).toBe(true);
    expect(methodAllowedInZone({ methods: ['dtf'] }, 'embroidery')).toBe(false);
  });

  it('allowedMethods: без зоны и правил — все 8 в порядке экрана', () => {
    expect(allowedMethods(undefined, null)).toEqual(METHOD_ORDER);
  });

  it('allowedMethods: пересечение методов зоны и правил категории (ключи визарда)', () => {
    const area = { zone_id: 'front', methods: ['silkscreen', 'dtf', 'embroidery'] as const };
    expect(allowedMethods({ ...area, methods: [...area.methods] }, rules(null, { front: ['dtf', 'embroidery'] })))
      .toEqual(['embroidery', 'dtf']);
    expect(allowedMethods({ ...area, methods: [...area.methods] }, rules(['screen']))).toEqual(['silkscreen']);
  });

  it('allowedMethods: правила не знают сублимацию и шевроны — их не режут', () => {
    expect(allowedMethods({ zone_id: 'back' }, rules(['screen']))).toEqual(['silkscreen', 'sublimation', 'patch', 'other']);
  });

  it('defaultMethod: метод зоны → первый допустимый → шелкография', () => {
    expect(defaultMethod({ zone_id: 'front', default_method: 'dtf' }, null)).toBe('dtf');
    expect(defaultMethod({ zone_id: 'front', methods: ['embroidery', 'dtg'] }, null)).toBe('embroidery');
    expect(defaultMethod(undefined, null)).toBe('silkscreen');
    expect(defaultMethod({ zone_id: 'front', methods: ['dtf'] }, rules(['screen']))).toBe('silkscreen');
  });

  it('defaultMethod: метод зоны, запрещённый правилами, не берётся', () => {
    expect(defaultMethod({ zone_id: 'front', default_method: 'dtf', methods: ['dtf', 'dtg'] }, rules(['dtg']))).toBe('dtg');
  });

  it('resolveMethod: метод нанесения важнее метода зоны', () => {
    expect(resolveMethod('dtg', { default_method: 'dtf' }, null)).toBe('dtg');
    expect(resolveMethod(undefined, { default_method: 'dtf' }, null)).toBe('dtf');
    expect(resolveMethod(undefined, undefined, null)).toBe('silkscreen');
  });
});

describe('methodSizeIssue — пределы размера по технике (веха 5в, B3; цифры — черновик технолога)', () => {
  it('меньше минимума — по меньшей стороне, блокирующее', () => {
    expect(methodSizeIssue('dtf', 2, 1)).toEqual({ kind: 'min', text: 'техника «DTF»: меньшая сторона — от 20 мм, сейчас 2 × 1 мм' });
    expect(methodSizeIssue('embroidery', 14, 40)?.kind).toBe('min');
  });
  it('больше максимума — с учётом поворота на 90°', () => {
    expect(methodSizeIssue('dtf', 600, 450)).toBeNull();
    expect(methodSizeIssue('dtf', 450, 600)).toBeNull();
    expect(methodSizeIssue('silkscreen', 420, 520)).toEqual({ kind: 'max', text: 'техника «Шелкография»: не больше 400 × 500 мм, сейчас 420 × 520 мм' });
  });
  it('без правил (прочее, шевроны, сублимация) и без мм — ничего', () => {
    expect(methodSizeIssue('other', 1, 1)).toBeNull();
    expect(methodSizeIssue('patch', 1, 1)).toBeNull();
    expect(methodSizeIssue('sublimation', 1, 1)).toBeNull();
    expect(methodSizeIssue('dtf', null, 10)).toBeNull();
    expect(methodSizeIssue('dtf', 0, 10)).toBeNull();
  });
});
