// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPLIERS_SEED, LABEL_LIBRARY_SEED, TZ_SETTINGS_SEED, PRICE_RULES_SEED, PACK_OPTIONS_SEED } from './seeds';
import { salesLabelPrice } from '../pricing/priceOrder';
import { PACKAGING_OPTIONS } from '../screens/labels';
import { SALES_PRINT_METHODS } from '../model/types';
import { MEDASTEX_COLORS, COTTONPROM_COLORS } from '../../data/colors';
import { FLEX_MATRIX } from '../../data/prices';
import type { LabelKind } from './types';

/**
 * Сторож сидов справочников (веха 4, миграция G).
 *
 * Сиды живут в двух местах — JSON в миграции (засев базы) и `seeds.ts`
 * (запасной путь стора), — и расхождение молча дало бы разные значения
 * «по умолчанию» в базе и в заказе, посчитанном без базы. Поэтому:
 *   · JSON каждого сида в миграции = модуль `seeds.ts`;
 *   · цена бирки из библиотеки = нынешняя `salesLabelPrice` для ВСЕХ комбинаций
 *     «вид × вариант × материал» (иначе перенос цены в библиотеку поменял бы КП);
 *   · ключи упаковки = CHECK упаковки ERP, и тот же список — в проверке сервера;
 *   · методы подготовки в проверке сервера = `SALES_PRINT_METHODS`.
 */
const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');
const G_FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith('_order_catalogs.sql'));
const G = readFileSync(join(MIGRATIONS, G_FILE ?? 'нет'), 'utf8');

/** JSON сида из блока `$seed_<имя>$…$seed_<имя>$` миграции */
function seedOf(name: string): unknown {
  const m = new RegExp(`\\$seed_${name}\\$([\\s\\S]*?)\\$seed_${name}\\$`).exec(G);
  if (!m) throw new Error(`сид ${name} не найден в ${G_FILE}`);
  return JSON.parse(m[1]);
}

/** Значения `check (packaging in (…))` из миграции ERP */
const checkValues = (file: string): string[] => {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  const m = sql.match(/check \(packaging in \(([^)]+)\)\)/);
  if (!m) throw new Error(`CHECK упаковки не найден в ${file}`);
  return m[1].split(',').map((v) => v.trim().replace(/'/g, ''));
};

/** Список строк из `<выражение> not in ('a', 'b')` в теле проверки миграции G */
const notInList = (anchor: string): string[] => {
  const i = G.indexOf(anchor);
  if (i < 0) throw new Error(`нет «${anchor}» в миграции G`);
  const m = /not in \(([^)]+)\)/.exec(G.slice(i));
  if (!m) throw new Error(`нет списка после «${anchor}»`);
  return m[1].split(',').map((v) => v.trim().replace(/'/g, ''));
};

/** Цена по библиотеке: вариант + надбавка материала (если вариант с материалом) */
function libraryPrice(kind: LabelKind, variantId: string, material: string): number {
  const v = kind.variants.find((x) => x.id === variantId);
  if (!v) throw new Error(`нет варианта ${variantId} у ${kind.type}`);
  const m = kind.materials.find((x) => x.key === material);
  return v.price + (v.withMaterial && m ? m.priceDelta : 0);
}

describe('сиды миграции G = seeds.ts', () => {
  it('миграция G найдена', () => {
    expect(G_FILE).toBeTruthy();
  });

  it('поставщики, бирки, подвал ТЗ и правила цены — дословно', () => {
    expect(seedOf('suppliers')).toEqual(SUPPLIERS_SEED);
    expect(seedOf('labelLibrary')).toEqual(LABEL_LIBRARY_SEED);
    expect(seedOf('tzSettings')).toEqual(TZ_SETTINGS_SEED);
    expect(seedOf('prices')).toEqual(PRICE_RULES_SEED);
  });

  it('матрица флекса в прайсе = FLEX_MATRIX кода (без сида вкладку «Флекс» в /sku не сохранить)', () => {
    // prices_patch правит только существующие ключи прайса, а на бою flexMatrix нет
    expect(seedOf('flexMatrix')).toEqual(FLEX_MATRIX);
    expect(G).toMatch(/jsonb_build_object\('flexMatrix', \$seed_flexMatrix\$/);
    expect(G).toMatch(/and not value \? 'flexMatrix';/);
  });

  it('палитры перенесены как есть: все цвета Медас и Коттонпром, ровно одна по умолчанию', () => {
    const [med, cot] = SUPPLIERS_SEED;
    expect(med.palette.colors.map((c) => c.code)).toEqual(MEDASTEX_COLORS.map((c) => c.code));
    expect(cot.palette.colors.map((c) => c.code)).toEqual(COTTONPROM_COLORS.map((c) => c.code));
    expect(SUPPLIERS_SEED.filter((s) => s.isDefault).map((s) => s.id)).toEqual(['cottonprom']);
    for (const s of SUPPLIERS_SEED) {
      const groups = new Set(s.palette.groups.map((g) => g.id));
      for (const c of s.palette.colors) {
        expect(c.hex, c.code).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(groups.has(c.group), c.code).toBe(true);
      }
    }
  });
});

describe('цена бирки из библиотеки = salesLabelPrice', () => {
  it('все комбинации вида, варианта и материала', () => {
    let checked = 0;
    for (const kind of LABEL_LIBRARY_SEED.kinds) {
      const materials = ['', ...kind.materials.map((m) => m.key)];
      for (const v of kind.variants) {
        for (const m of materials) {
          const variant_id = [v.id, m].filter(Boolean).join(':');
          const want = salesLabelPrice({ label_type: kind.type, variant_id });
          // Материал не выбран — LabelRow показывает «Тканая» (надбавка 0)
          expect(libraryPrice(kind, v.id, m), `${kind.type} ${variant_id}`).toBe(want);
          checked += 1;
        }
      }
    }
    // composition 3 + brand 3×4 + hangtag 2 — сторож не пуст
    expect(checked).toBe(17);
  });

  it('вид без вариантов в библиотеке и в нынешнем расчёте стоит 0', () => {
    for (const kind of LABEL_LIBRARY_SEED.kinds.filter((k) => k.variants.length === 0)) {
      expect(salesLabelPrice({ label_type: kind.type, variant_id: 'standard' }), kind.type).toBe(0);
    }
  });
});

describe('упаковка и подготовка — списки сервера', () => {
  const ORDER_VALUES = checkValues('20260717150000_erp_tz_fields.sql');

  it('ключи упаковки сида = CHECK упаковки заказа ERP = виды интерфейса', () => {
    expect(PACK_OPTIONS_SEED.map((o) => o.key).sort()).toEqual([...ORDER_VALUES].sort());
    expect(PACKAGING_OPTIONS.map((o) => o.key).sort()).toEqual([...ORDER_VALUES].sort());
  });

  it('проверка packOptions в миграции G — тот же список', () => {
    expect(notInList("(o->>'key')").sort()).toEqual([...ORDER_VALUES].sort());
  });

  it('проверка prepFees в миграции G — методы SALES_PRINT_METHODS', () => {
    expect(notInList('f.key').sort()).toEqual([...SALES_PRINT_METHODS].sort());
  });
});
