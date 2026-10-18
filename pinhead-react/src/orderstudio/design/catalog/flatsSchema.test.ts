import { describe, it, expect } from 'vitest';
import * as z from 'zod/mini';
import { catalogIssues, flatIssues, flatSchema, flatSchemaIssues, parseFlatsCatalog, printAreaSchema } from './flatsSchema';
import { parseFlatsCatalog as parse5a } from './fixtures/flatSchema5a';
import { FLATS_CASES, validFlatsCatalog } from './flatsCases';
import { releaseFlat } from './flatVersion';
import { area, flat } from '../fixtures.testutil';

describe('flatsSchema — общий набор случаев (flatsCases)', () => {
  it('имена случаев уникальны (на них ссылаются пробы)', () => {
    const names = FLATS_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(FLATS_CASES)('$name — $note', ({ value, ok }) => {
    expect(parseFlatsCatalog(value).ok).toBe(ok);
  });
});

describe('parseFlatsCatalog — терпимый разбор', () => {
  it('образец проходит целиком', () => {
    const r = parseFlatsCatalog(validFlatsCatalog());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.catalog.flats.map((f) => f.id)).toEqual(['tshirt-regular']);
  });

  it('битая форма — пустой справочник и замечание, без исключения', () => {
    for (const raw of [null, undefined, 'x', 42, { flats: 'нет' }]) {
      const r = parseFlatsCatalog(raw);
      expect(r.ok).toBe(false);
      expect(r.catalog.flats).toEqual([]);
      expect(r.issues[0]).toMatch(/неверная форма/);
    }
  });

  it('битый флэт отброшен, соседний остаётся; замечание по-русски с путём', () => {
    const good = flat({ id: 'good' });
    const bad = { ...flat({ id: 'bad' }), version: 0 };
    const r = parseFlatsCatalog({ version: 1, flats: [bad, good] });
    expect(r.ok).toBe(false);
    expect(r.catalog.flats.map((f) => f.id)).toEqual(['good']);
    expect(r.issues.some((i) => i.startsWith('Флэт «bad»: version'))).toBe(true);
  });

  it('дубль id — первый остаётся, второй отброшен', () => {
    const r = parseFlatsCatalog({ version: 1, flats: [flat({ id: 'a', name: 'Первый' }), flat({ id: 'a', name: 'Второй' })] });
    expect(r.catalog.flats.map((f) => f.name)).toEqual(['Первый']);
    expect(r.issues).toEqual(['Флэт «a»: id повторяется']);
  });

  it('чужой путь SVG назван ожидаемым путём (M5)', () => {
    const f = flat({ id: 'x' });
    const r = parseFlatsCatalog({ version: 1, flats: [{ ...f, views: [{ ...f.views[0], svg_path: 'orders/1/a.svg' }] }] });
    expect(r.issues.join('\n')).toContain('flats/x/v1/front.svg');
  });

  it('путь версионный: версия 2 требует v2', () => {
    const f = flat({ id: 'y', version: 2 });
    expect(z.safeParse(flatSchema, f).success).toBe(true);
    const old = { ...f, views: f.views.map((v) => ({ ...v, svg_path: v.svg_path.replace('/v2/', '/v1/') })) };
    expect(z.safeParse(flatSchema, old).success).toBe(false);
  });

  it('лишние поля отбрасываются, а не ломают разбор', () => {
    const r = parseFlatsCatalog({ version: 1, flats: [{ ...flat(), evil: '<script>' }] });
    expect(r.ok).toBe(true);
    expect('evil' in r.catalog.flats[0]).toBe(false);
  });
});

describe('printAreaSchema — инварианты DM', () => {
  const base = { id: 'chest', name: 'Грудь', zone_id: 'front', polygon_mm: [[0, 0], [100, 0], [100, 100], [0, 100]], safe_inset_mm: 5 };

  it('methods опционален', () => {
    expect(z.safeParse(printAreaSchema, base).success).toBe(true);
    expect(z.safeParse(printAreaSchema, { ...base, methods: ['dtf', 'silkscreen'] }).success).toBe(true);
  });

  it('zone_id — код или null, но не пропущен', () => {
    expect(z.safeParse(printAreaSchema, { ...base, zone_id: null }).success).toBe(true);
    const { zone_id: _drop, ...noZone } = base;
    expect(z.safeParse(printAreaSchema, noZone).success).toBe(false);
  });

  it('безопасный отступ ×2 меньше меньшей стороны', () => {
    expect(z.safeParse(printAreaSchema, { ...base, safe_inset_mm: 50 }).success).toBe(false);
    expect(z.safeParse(printAreaSchema, { ...base, safe_inset_mm: 49 }).success).toBe(true);
  });

  it('вырожденная зона (все точки на линии) — отказ', () => {
    expect(z.safeParse(printAreaSchema, { ...base, polygon_mm: [[0, 0], [100, 0], [50, 0]] }).success).toBe(false);
  });

  it('NaN и бесконечность в координатах — отказ', () => {
    expect(z.safeParse(printAreaSchema, { ...base, polygon_mm: [[0, 0], [Infinity, 0], [100, 100]] }).success).toBe(false);
    expect(z.safeParse(printAreaSchema, { ...base, polygon_mm: [[0, 0], [NaN, 0], [100, 100]] }).success).toBe(false);
  });
});

describe('веха 5б — история, строки ТЗ, коды моделей', () => {
  const sleeve = () => ({
    kind: 'sleeve_left' as const, svg_path: 'flats/tshirt-test/v1/sleeve_left.svg', scale_mm_per_unit: 1,
    anchors: { sleeve_bottom_y: 500, sleeve_center_x: 150 },
    print_areas: [area({ id: 'sleeve', name: 'Левый рукав', zone_id: 'sleeve-l', tz_row: 'sleeve_l', polygon_mm: [[100, 100], [200, 100], [200, 300], [100, 300]], safe_inset_mm: 5 })],
  });
  const catalog5b = () => {
    const base = flat();
    const draft = { ...base, views: [...base.views, sleeve()] };
    draft.views[0] = { ...draft.views[0], print_areas: [area({ tz_row: 'front_l' })] };
    return { version: 1, flats: [releaseFlat(base, draft, 2), flat({ id: 'polo-test' })] };
  };

  it('справочник 5б проходит схему 5б целиком', () => {
    expect(parseFlatsCatalog(catalog5b()).issues).toEqual([]);
  });

  it('страж К16: клиент 5а разбирает справочник 5б без падения и без потери флэтов', () => {
    const r = parse5a(catalog5b());
    expect(r.issues).toEqual([]);
    expect(r.catalog.flats.map((f) => f.id)).toEqual(['tshirt-test', 'polo-test']);
    expect('history' in r.catalog.flats[0]).toBe(false);
  });

  it('путь вида истории — по формуле с версией записи', () => {
    const f = catalog5b().flats[0];
    const bad = { ...f, history: [{ version: 1, views: f.views }] };
    expect(flatIssues(bad).join('\n')).toContain('flats/tshirt-test/v1/front.svg');
  });

  it('flatSchemaIssues — путь поля и текст; корректный флэт — пусто', () => {
    expect(flatSchemaIssues(flat())).toEqual([]);
    const bad = flat();
    bad.views[0].print_areas[0] = { ...bad.views[0].print_areas[0], safe_inset_mm: -1 };
    const issues = flatSchemaIssues(bad);
    expect(issues[0].path).toEqual(['views', 0, 'print_areas', 0, 'safe_inset_mm']);
    expect(issues[0].text).toMatch(/^views\.0\.print_areas\.0\.safe_inset_mm: /);
  });

  it('catalogIssues — код модели у двух активных; снятый код не занимает', () => {
    const a = { ...flat({ id: 'a' }), sku_codes: ['T-006'] };
    const b = { ...flat({ id: 'b' }), sku_codes: ['T-006'] };
    expect(catalogIssues([a, b])).toEqual(['Флэт «b»: модель T-006 уже у флэта «a»']);
    expect(catalogIssues([a, { ...b, active: false }])).toEqual([]);
    expect(catalogIssues([{ ...a, sku_codes: ['T-006', 'T-006'] }])).toEqual([]);
  });
});
