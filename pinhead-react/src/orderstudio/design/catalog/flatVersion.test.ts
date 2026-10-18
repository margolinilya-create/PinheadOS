import { describe, it, expect } from 'vitest';
import { newSalesPrint } from '../../model/factory';
import { anchorsSchema, flatSchema, parseFlatsCatalog, printAreaSchema, viewSchema } from './flatsSchema';
import {
  GEOMETRY_KEYS, META_KEYS, catalogBytes, flatAtVersion, geometryChanged, geometryOf, historyPreserved,
  itemFlatVersion, mergeFlatIntoRaw, nextVersion, releaseFlat, stableJson,
} from './flatVersion';
import { area, clone, flat, frontView } from '../fixtures.testutil';
import type { FlatView, GarmentFlat } from '../types';

/** Флэт, у которого заполнены ВСЕ ключи схем: флэта, вида, якорей, зоны */
function fullFlat(): GarmentFlat {
  const full = area({ tz_row: 'front', methods: ['dtf', 'dtg'], default_method: 'dtg', max_print_mm: { width: 280, height: 380 }, min_print_mm: { width: 20, height: 20 } });
  const anchors = { neckline_point: { x: 300, y: 92 }, center_axis_x: 300, sleeve_bottom_y: 600, sleeve_center_x: 100, axes: [{ id: 'dart', name: 'Вытачка', x: 200 }] };
  const v1 = frontView({ svg_path: 'flats/tshirt-test/v1/front.svg', anchors, print_areas: [full] });
  const v2: FlatView = { ...frontView({ svg_path: 'flats/tshirt-test/v2/front.svg', anchors, print_areas: [full] }), size_anchors: { M: anchors }, grade_rule: { center_axis_dx: 1 } };
  return { ...flat({ id: 'tshirt-test', version: 2, views: [v2] }), sku_codes: ['T-006'], history: [{ version: 1, views: [v1] }] };
}

const sets = (k: keyof typeof GEOMETRY_KEYS) => [...GEOMETRY_KEYS[k], ...META_KEYS[k]];
const SHAPES = {
  flat: Object.keys(flatSchema.shape),
  view: Object.keys(viewSchema.shape),
  anchors: Object.keys(anchorsSchema.shape),
  area: Object.keys(printAreaSchema.shape),
} as const;

describe('классификация полей — геометрия и метаданные (К6, сторож)', () => {
  it.each(Object.keys(SHAPES) as (keyof typeof SHAPES)[])('%s: каждый ключ схемы ровно в одном множестве', (k) => {
    const all = sets(k);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...SHAPES[k]].sort());
  });

  it('фикстура заполняет все ключи схем и проходит схему', () => {
    const f = fullFlat();
    expect(parseFlatsCatalog({ version: 1, flats: [f] }).issues).toEqual([]);
    expect(Object.keys(f).sort()).toEqual([...SHAPES.flat].sort());
    expect(Object.keys(f.views[0]).sort()).toEqual([...SHAPES.view].sort());
    expect(Object.keys(f.views[0].anchors).sort()).toEqual([...SHAPES.anchors].sort());
    expect(Object.keys(f.views[0].print_areas[0]).sort()).toEqual([...SHAPES.area].sort());
  });

  type Level = 'flat' | 'view' | 'anchors' | 'area';
  const mutate = (level: Level, key: string): GarmentFlat => {
    const f = clone(fullFlat()) as unknown as Record<string, unknown> & GarmentFlat;
    const target: Record<string, unknown> = level === 'flat' ? f
      : level === 'view' ? f.views[0] as unknown as Record<string, unknown>
        : level === 'anchors' ? f.views[0].anchors as unknown as Record<string, unknown>
          : f.views[0].print_areas[0] as unknown as Record<string, unknown>;
    target[key] = Array.isArray(target[key]) ? [] : { changed: key };
    return f;
  };
  const cases = (['flat', 'view', 'anchors', 'area'] as Level[]).flatMap((level) => [
    ...GEOMETRY_KEYS[level].map((key) => ({ level, key, geometry: true })),
    ...META_KEYS[level].map((key) => ({ level, key, geometry: false })),
  ]);

  it.each(cases)('$level: $key → geometryChanged = $geometry', ({ level, key, geometry }) => {
    expect(geometryChanged(fullFlat(), mutate(level, key), [])).toBe(geometry);
  });
});

describe('geometryChanged / geometryOf', () => {
  it('правка polygon_mm и смена zone_id — геометрия', () => {
    const base = flat();
    const poly = clone(base);
    poly.views[0].print_areas[0].polygon_mm[0] = [151, 140];
    expect(geometryChanged(base, poly, [])).toBe(true);
    const zone = clone(base);
    zone.views[0].print_areas[0].zone_id = 'pocket';
    expect(geometryChanged(base, zone, [])).toBe(true);
  });

  it('правка tz_row, имени зоны, техник — не геометрия', () => {
    const base = flat();
    const next = clone(base);
    Object.assign(next.views[0].print_areas[0], { tz_row: 'front_l', name: 'Грудь слева', methods: ['dtf'] });
    expect(geometryChanged(base, next, [])).toBe(false);
  });

  it('новый флэт и новый файл вида — всегда новая версия', () => {
    expect(geometryChanged(null, flat(), [])).toBe(true);
    expect(geometryChanged(flat(), flat(), ['front'])).toBe(true);
  });

  it('порядок ключей не важен', () => {
    const base = flat();
    const re = clone(base);
    re.views[0].anchors = { center_axis_x: 300, neckline_point: { y: 92, x: 300 } };
    expect(geometryChanged(base, re, [])).toBe(false);
    expect(stableJson({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(stableJson(geometryOf(base))).not.toContain('Футболка');
  });
});

describe('версии и выпуск', () => {
  it('nextVersion: max(текущая, история) + 1 + skip; новый — 1 + skip', () => {
    expect(nextVersion(null)).toBe(1);
    expect(nextVersion(null, 2)).toBe(3);
    expect(nextVersion(flat({ version: 3 }))).toBe(4);
    expect(nextVersion({ ...fullFlat(), history: [{ version: 7, views: fullFlat().views }] })).toBe(8);
    expect(nextVersion(flat(), 4)).toBe(6);
  });

  it('releaseFlat дописывает историю и меняет все пути', () => {
    const base = flat();
    const draft = clone(base);
    draft.views[0].print_areas[0].polygon_mm[0] = [160, 140];
    const out = releaseFlat(base, draft, 2);
    expect(out.version).toBe(2);
    expect(out.views.map((v) => v.svg_path)).toEqual(['flats/tshirt-test/v2/front.svg', 'flats/tshirt-test/v2/back.svg']);
    expect(out.history).toEqual([{ version: 1, views: base.views }]);
    expect(historyPreserved(base, out)).toBe(true);
    expect(parseFlatsCatalog({ version: 1, flats: [out] }).issues).toEqual([]);
    const again = releaseFlat(out, clone(out), 3);
    expect(again.history?.map((h) => h.version)).toEqual([1, 2]);
    expect(historyPreserved(out, again)).toBe(true);
  });

  it('releaseFlat нового флэта — без истории; версия не выше базы — не выпуск', () => {
    const fresh = releaseFlat(null, { ...flat(), history: [{ version: 1, views: [] }] }, 1);
    expect('history' in fresh).toBe(false);
    const base = fullFlat();
    const meta = releaseFlat(base, { ...clone(base), name: 'Другое имя', history: [] }, 2);
    expect(meta.history).toEqual(base.history);
    expect(meta.version).toBe(2);
  });

  it('historyPreserved ловит потерю и правку записи и невыписанную историю', () => {
    const base = fullFlat();
    expect(historyPreserved(base, clone(base))).toBe(true);
    expect(historyPreserved(base, { ...clone(base), history: [] })).toBe(false);
    const edited = clone(base);
    edited.history![0].views[0].print_areas[0].polygon_mm[0] = [1, 1];
    expect(historyPreserved(base, edited)).toBe(false);
    const noArchive = { ...clone(base), version: 3 };
    expect(historyPreserved(base, noArchive)).toBe(false);
    expect(historyPreserved(null, base)).toBe(true);
  });
});

describe('flatAtVersion (К1)', () => {
  const v2 = () => {
    const base = flat();
    const draft = clone(base);
    draft.views[0].print_areas[0].polygon_mm = [[100, 100], [400, 100], [400, 400], [100, 400]];
    return releaseFlat(base, draft, 2);
  };

  it('текущая — флэт как есть; неизвестная — null', () => {
    const f = v2();
    expect(flatAtVersion(f, 2)).toBe(f);
    expect(flatAtVersion(f, 5)).toBeNull();
  });

  it('из истории: version = V, геометрия и пути версии V, истории нет', () => {
    const old = flatAtVersion(v2(), 1)!;
    expect(old.version).toBe(1);
    expect(old.views[0].svg_path).toBe('flats/tshirt-test/v1/front.svg');
    expect(old.views[0].print_areas[0].polygon_mm[0]).toEqual([150, 140]);
    expect('history' in old).toBe(false);
    expect(parseFlatsCatalog({ version: 1, flats: [old] }).issues).toEqual([]);
  });

  it('метаданные зоны — из текущей версии по виду и id; запись истории не правится', () => {
    const f = v2();
    Object.assign(f.views[0].print_areas[0], { tz_row: 'front_l', name: 'Грудь (новое имя)', methods: ['dtf'] });
    const old = flatAtVersion(f, 1)!;
    expect(old.views[0].print_areas[0]).toMatchObject({ tz_row: 'front_l', name: 'Грудь (новое имя)', methods: ['dtf'] });
    expect(f.history![0].views[0].print_areas[0].tz_row).toBeUndefined();
    const dropped = clone(f);
    delete dropped.views[0].print_areas[0].tz_row;
    dropped.history![0].views[0].print_areas[0].tz_row = 'back';
    expect(flatAtVersion(dropped, 1)!.views[0].print_areas[0].tz_row).toBeUndefined();
  });

  it('зоны нет в текущей версии — метаданные истории как есть', () => {
    const f = v2();
    f.views[0].print_areas[0] = { ...f.views[0].print_areas[0], id: 'chest2' };
    expect(flatAtVersion(f, 1)!.views[0].print_areas[0].name).toBe('Грудь');
  });
});

describe('склейка справочника и размер', () => {
  it('mergeFlatIntoRaw: строки нет — справочник из одной записи', () => {
    const f = flat();
    expect(mergeFlatIntoRaw(null, f)).toEqual({ version: 1, flats: [f] });
    expect(mergeFlatIntoRaw(undefined, f)).toEqual({ version: 1, flats: [f] });
  });

  it('mergeFlatIntoRaw: неверная форма — bad_shape', () => {
    for (const raw of ['x', 1, [], { version: 2, flats: [] }, { version: 1, flats: {} }]) expect(mergeFlatIntoRaw(raw, flat())).toBe('bad_shape');
  });

  it('mergeFlatIntoRaw: прочие записи — те же ссылки, правленая заменена, новая дописана', () => {
    const broken = { id: 'broken', version: 0, future: { x: 1 } };
    const other = flat({ id: 'other' });
    const raw = { version: 1, flats: [broken, flat(), other] };
    const edited = { ...flat(), name: 'Новое' };
    const out = mergeFlatIntoRaw(raw, edited) as { flats: unknown[] };
    expect(out.flats[0]).toBe(broken);
    expect(out.flats[1]).toBe(edited);
    expect(out.flats[2]).toBe(other);
    const added = mergeFlatIntoRaw(raw, flat({ id: 'new' })) as { flats: unknown[] };
    expect(added.flats).toHaveLength(4);
    expect(raw.flats).toHaveLength(3);
  });

  it('catalogBytes — байты UTF-8, кириллица — 2 байта', () => {
    expect(catalogBytes({ a: 'ф' })).toBe('{"a":""}'.length + 2);
    expect(catalogBytes('abc')).toBe(5);
  });
});

describe('itemFlatVersion (К15)', () => {
  const layout = (id: string, ver: number) => ({
    v: 1, flat_id: id, flat_version: ver, view: 'front', area_id: 'chest', x_mm: 10, y_mm: 10, rotation_deg: 0, flip_h: false, flip_v: false,
    asset: { type: 'png', source_file: 'a.png', intrinsic_w_mm: 10, intrinsic_h_mm: 10, size_estimated: false, has_preview: false },
  });
  const print = (id: string, ver: number) => newSalesPrint({ layout: layout(id, ver) });
  const f = releaseFlat(flat(), flat(), 2);

  it('раскладок нет — текущая версия', () => {
    expect(itemFlatVersion([newSalesPrint()], f)).toEqual({ version: 2, mixed: false, known: true });
  });

  it('одна известная версия — она; раскладки другого флэта не считаются', () => {
    expect(itemFlatVersion([print('tshirt-test', 1), print('tshirt-test', 1), print('hoodie', 7)], f)).toEqual({ version: 1, mixed: false, known: true });
  });

  it('несколько версий — текущая с пометкой; неизвестная — текущая, known = false', () => {
    expect(itemFlatVersion([print('tshirt-test', 1), print('tshirt-test', 2)], f)).toEqual({ version: 2, mixed: true, known: true });
    expect(itemFlatVersion([print('tshirt-test', 9)], f)).toEqual({ version: 2, mixed: false, known: false });
  });
});
