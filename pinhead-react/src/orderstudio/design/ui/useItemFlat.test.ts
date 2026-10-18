import { describe, it, expect } from 'vitest';
import { newSalesPrint } from '../../model/factory';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { ZoneDefinition } from '../../../types/catalog';
import type { AssetMeta } from '../types';
import { newPlacedPrint, parseLayout } from '../model/layout';
import { flatAtVersion } from '../catalog/flatVersion';
import { flat } from '../fixtures.testutil';
import { sleevedFlat, versionedFlat } from '../fixtures5b.testutil';
import { onOldVersion, resolveItemFlat, transferToCurrent, viewsOf } from './useItemFlat';

const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const ASSET: AssetMeta = { type: 'png', source_file: 'l.png', intrinsic_w_mm: 60, intrinsic_h_mm: 40, size_estimated: false, has_preview: false };
const FLAT = versionedFlat();
const on = (version: 1 | 2, areaId = 'chest') => newPlacedPrint(ASSET, '', areaId, {
  flat: version === 1 ? flatAtVersion(FLAT, 1)! : FLAT, zonesCatalog: ZONES, category: 'tshirts', view: 'front', itemKind: 'sku', method: 'dtf',
})!;

describe('viewsOf — порядок вкладок', () => {
  it('перед → спина → левый → правый рукав, только существующие', () => {
    const f = sleevedFlat();
    expect(viewsOf({ ...f, views: [...f.views].reverse() })).toEqual(['front', 'back', 'sleeve_left', 'sleeve_right']);
    expect(viewsOf(flat())).toEqual(['front', 'back']);
    expect(viewsOf(null)).toEqual([]);
  });
});

describe('resolveItemFlat — версия позиции (К15)', () => {
  it('раскладок нет — текущая, не устарела', () => {
    expect(resolveItemFlat(FLAT, [newSalesPrint()])).toMatchObject({ flat: FLAT, outdated: false });
  });
  it('все на v1 — флэт версии 1, устарела', () => {
    const r = resolveItemFlat(FLAT, [on(1)]);
    expect(r.flat?.version).toBe(1);
    expect(r.outdated).toBe(true);
  });
  it('версии разные — текущая с пометкой', () => {
    const r = resolveItemFlat(FLAT, [on(1), on(2)]);
    expect(r.flat).toBe(FLAT);
    expect(r).toMatchObject({ outdated: true, version: { mixed: true } });
  });
  it('версии нет в истории — текущая с пометкой', () => {
    const p = on(1);
    const odd = { ...p, layout: { ...(p.layout as object), flat_version: 9 } };
    expect(resolveItemFlat(FLAT, [odd])).toMatchObject({ flat: FLAT, outdated: true, version: { known: false } });
  });
});

describe('transferToCurrent — «Перенести на версию M»', () => {
  it('переносит только раскладки прежних версий; текущие — те же объекты', () => {
    const old = on(1);
    const cur = on(2);
    const r = transferToCurrent([old, cur], FLAT, { zonesCatalog: ZONES, category: 'tshirts' })!;
    expect(r.prints[1]).toBe(cur);
    expect(parseLayout(r.prints[0].layout)?.flat_version).toBe(2);
    expect(onOldVersion(r.prints[0], FLAT)).toBe(false);
    expect(r.dropped).toBe(0);
  });
  it('переносить нечего — null (commit ничего не пишет)', () => {
    expect(transferToCurrent([on(2)], FLAT, { zonesCatalog: ZONES, category: 'tshirts' })).toBeNull();
  });
});
