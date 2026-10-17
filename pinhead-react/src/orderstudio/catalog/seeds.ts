/**
 * Сиды справочников заказа (веха 4, миграция G).
 *
 * Два назначения, и оба требуют, чтобы значения совпадали ДОСЛОВНО:
 *   1. Миграция G засевает ими базу (`on conflict do nothing`; прайс —
 *      `jsonb_build_object(новые) || value`, существующее значение побеждает).
 *      Сторож `seedsMatch.test.ts` сверяет JSON миграции с этим модулем.
 *   2. Запасной путь стора: справочник не загрузился или ключа ещё нет —
 *      заказ считается по сидам (`catalogSource: 'fallback'`), а редактор
 *      сохранять такое не даёт (задача 2).
 *
 * Источники — нынешние константы кода, ничего не придумано:
 *   · палитры — `MEDASTEX_COLORS`/`COLOR_GROUPS`, `COTTONPROM_*` (data/colors);
 *     Медастекс — у тканей поставщика «Медас», Коттонпром — палитра по умолчанию
 *     (как `utils/colorSupplier`);
 *   · бирки — варианты `LabelRow`, материалы `LABEL_CONFIG`, цены — функции
 *     `pricingCore` (сторож проверяет все комбинации), схемы — места крепления
 *     `LABEL_CONFIG.mainLabel.placements`;
 *   · упаковка — 4 ключа CHECK упаковки ERP, цены и подписи — `PRICES.packOptions`
 *     и `PACKAGING_OPTIONS` (`other` — по договорённости, 0 ₽).
 */
import { MEDASTEX_COLORS, COLOR_GROUPS, COTTONPROM_COLORS, COTTONPROM_GROUPS } from '../../data/colors';
import { LABEL_CONFIG } from '../../data/extras';
import { careLabelPrice, mainLabelPrice, hangTagPrice } from '../../utils/pricingCore';
import { LABEL_TYPE_TO_ERP } from '../bridge/erpNames';
import type {
  LabelKind, LabelLibrary, PackOption, Palette, PriceRulesPatch, Supplier, TzSettings,
} from './types';

interface RawColor { code: string; name: string; hex: string }
interface RawGroup { label: string; codes: string[] }

/** Палитра из пары «цвета + группы»; id группы — `<поставщик>-<номер>` */
function paletteOf(prefix: string, colors: RawColor[], groups: RawGroup[]): Palette {
  const groupIds = groups.map((_, i) => `${prefix}-${i + 1}`);
  const groupOf = (code: string): string => {
    const i = groups.findIndex((g) => g.codes.includes(code));
    return i < 0 ? '' : groupIds[i];
  };
  return {
    groups: groups.map((g, i) => ({ id: groupIds[i], label: g.label })),
    colors: colors.map((c) => ({ code: c.code, name: c.name, hex: c.hex, group: groupOf(c.code), active: true })),
  };
}

export const SUPPLIERS_SEED: Supplier[] = [
  {
    id: 'medastex',
    name: 'Медастекс',
    isDefault: false,
    fabricSupplierNames: ['Медас'],
    active: true,
    palette: paletteOf('medastex', MEDASTEX_COLORS, COLOR_GROUPS),
  },
  {
    id: 'cottonprom',
    name: 'Коттонпром',
    isDefault: true,
    fabricSupplierNames: [],
    active: true,
    palette: paletteOf('cottonprom', COTTONPROM_COLORS, COTTONPROM_GROUPS),
  },
];

const BRAND_MATERIALS = LABEL_CONFIG.mainLabel.materials.map((m) => ({
  key: m.key, name: m.name, priceDelta: m.priceDelta, active: true,
}));

/** Цена варианта — те же функции, что считают бирку сегодня (`salesLabelPrice`) */
const PRICED_KINDS: Record<string, Omit<LabelKind, 'type' | 'name' | 'active'>> = {
  composition: {
    variants: [
      { id: 'standard', name: 'Стандартный', price: careLabelPrice('standard'), withMaterial: false, active: true },
      { id: 'my-logo', name: 'С логотипом', price: careLabelPrice('my-logo'), withMaterial: false, active: true },
      { id: 'no-logo', name: 'Без логотипа', price: careLabelPrice('no-logo'), withMaterial: false, active: true },
    ],
    materials: [],
  },
  brand: {
    variants: [
      { id: 'standard', name: 'Стандартная', price: mainLabelPrice('standard'), withMaterial: true, active: true },
      { id: 'custom', name: 'Своя (дизайн клиента)', price: mainLabelPrice('custom'), withMaterial: true, active: true },
      { id: 'send-own', name: 'Бирка клиента — пришлёт сам', price: mainLabelPrice('send-own'), withMaterial: false, active: true },
    ],
    materials: BRAND_MATERIALS,
  },
  hangtag: {
    variants: [
      { id: 'standard', name: 'Стандартный', price: hangTagPrice('standard'), withMaterial: false, active: true },
      { id: 'custom', name: 'Свой', price: hangTagPrice('custom'), withMaterial: false, active: true },
    ],
    materials: [],
  },
};

export const LABEL_LIBRARY_SEED: LabelLibrary = {
  kinds: Object.entries(LABEL_TYPE_TO_ERP).map(([type, name]) => ({
    type,
    name,
    variants: PRICED_KINDS[type]?.variants ?? [],
    materials: PRICED_KINDS[type]?.materials ?? [],
    active: true,
  })),
  schemes: LABEL_CONFIG.mainLabel.placements.map((p) => ({ id: p.key, name: p.name, active: true })),
};

export const TZ_SETTINGS_SEED: TzSettings = {
  footerText: 'Допуск по размещению нанесения — до 2 см',
};

/** Упаковка: 4 ключа CHECK ERP (none/bopp/zip/other) */
export const PACK_OPTIONS_SEED: PackOption[] = [
  { key: 'none', name: 'Без упаковки', price: 0 },
  { key: 'bopp', name: 'БОПП пакет', price: 20 },
  { key: 'zip', name: 'ЗИП пакет', price: 40 },
  { key: 'other', name: 'Другая — опишите в требованиях', price: 0 },
];

/**
 * Три новых ключа прайса. Решение владельца: подготовка — 0 (пустой объект),
 * порог маржи пуст — «не предупреждать».
 */
export const PRICE_RULES_SEED: Required<PriceRulesPatch> = {
  packOptions: PACK_OPTIONS_SEED,
  prepFees: {},
  minMarginPct: null,
};
