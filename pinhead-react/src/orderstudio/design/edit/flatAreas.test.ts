import { describe, it, expect } from 'vitest';
import { defaultAreas, defaultZoneId } from './flatAreas';
import { areasOutsideFlat } from '../catalog/zoneFit';
import { printAreaSchema } from '../catalog/flatsSchema';
import * as z from 'zod/mini';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import { FLAT_VIEW_KINDS } from '../types';

const MM = { w: 600, h: 800 };

describe('зоны нового вида по умолчанию (решение 21)', () => {
  it.each([
    ['front', 'front', 'Грудь (перед)'],
    ['back', 'back', 'Спина'],
    ['sleeve_left', 'sleeve-l', 'Левый рукав'],
    ['sleeve_right', 'sleeve-r', 'Правый рукав'],
  ] as const)('%s → зона %s, внутри силуэта, проходит схему', (kind, zoneId, name) => {
    const [a] = defaultAreas(kind, 'tshirt', MM, ZONES_CATALOG_DEFAULT);
    expect(a).toMatchObject({ zone_id: zoneId, name });
    expect(areasOutsideFlat({ print_areas: [a] }, MM)).toEqual([]);
    expect(z.safeParse(printAreaSchema, a).success).toBe(true);
  });

  it('штаны и шоппер — свои зоны', () => {
    expect(defaultZoneId('front', 'pants')).toBe('pants-front');
    expect(defaultZoneId('back', 'pants')).toBe('pants-back');
    expect(defaultZoneId('front', 'shopper')).toBe('side-a');
    expect(defaultZoneId('back', 'shopper')).toBe('side-b');
  });

  it('зоны нет, она снята или справочник не загрузился — служебная зона с именем вида', () => {
    for (const kind of FLAT_VIEW_KINDS) {
      expect(defaultAreas(kind, 'tshirt', MM, null)[0].zone_id).toBeNull();
    }
    expect(defaultAreas('front', 'tshirt', MM, [])[0]).toMatchObject({ zone_id: null, name: 'Перед', id: 'front' });
    const snyata = ZONES_CATALOG_DEFAULT.map((zn) => (zn.id === 'back' ? { ...zn, active: false } : zn));
    expect(defaultAreas('back', 'tshirt', MM, snyata)[0]).toMatchObject({ zone_id: null, name: 'Спина' });
  });
});
