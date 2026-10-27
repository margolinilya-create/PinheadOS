/**
 * Техники нанесения Order — одно место (веха 5а, задача 1).
 *
 * - подписи и порядок на экране (`METHOD_LABELS`, `METHOD_ORDER`; `screens/labels`
 *   реэкспортирует их отсюда);
 * - профили всех 8 техник: цветовая модель, Pantone, контроль качества макета
 *   (DPI либо минимальная деталь у вышивки) — читают холст, preflight и PDF макета;
 * - перевод техник визарда (`screen`, `flex`, …) в техники Order и обратно —
 *   его читают `wizard/wizardAdapter` и правила категории (`allowedTechs`
 *   и `allowedZoneTechs` хранятся в ключах визарда);
 * - выбор техники в зоне флэта (решение 8 плана вехи 5а).
 *
 * Модуль чистый: без React, стора и импортов ERP.
 *
 * Пороги DPI — как в дизайн-мейкере (ответ владельца 17.10): DTF, шелкография,
 * DTG и флекс — 300 / 150 (предупреждение / серьёзное предупреждение), вышивка —
 * подсказка о мелкой детали. Ничего не блокирует.
 */
import type { SalesPrintMethod } from './types';

export const METHOD_LABELS: Record<SalesPrintMethod, string> = {
  silkscreen: 'Шелкография',
  embroidery: 'Вышивка',
  dtf: 'DTF',
  heat_transfer: 'Флекс / термоперенос',
  dtg: 'DTG',
  sublimation: 'Сублимация',
  patch: 'Шевроны / нашивки',
  other: 'Прочее / подряд',
};

export const METHOD_ORDER: SalesPrintMethod[] = [
  'silkscreen', 'embroidery', 'dtf', 'heat_transfer', 'dtg', 'sublimation', 'patch', 'other',
];

/** Техника по умолчанию, когда ни нанесение, ни зона, ни правила её не задают */
export const DEFAULT_PRINT_METHOD: SalesPrintMethod = 'silkscreen';

// ── Профили ───────────────────────────────────────────────────────────────

export type ColorMode = 'cmyk' | 'spot';

export interface PrintMethodProfile {
  id: SalesPrintMethod;
  /** Полная подпись — `METHOD_LABELS` */
  label: string;
  /** Короткая метка для бейджей холста */
  short: string;
  colorMode: ColorMode;
  /** Уместны ли Pantone-цвета */
  pantone: boolean;
  /** Контроль растрового макета по эффективному DPI */
  dpi?: { good: number; min: number };
  /** Контроль по минимальной детали, мм (вышивка вместо DPI) */
  detail?: { minLineMm: number; minTextMm: number };
  /**
   * Пределы размера нанесения, мм (веха 5в, B3; черновые цифры — подтверждает
   * технолог): меньшая сторона — не меньше `minMm`, рамка — не больше
   * `maxW × maxH` с поворотом на 90°.
   */
  size?: { minMm: number; maxW: number; maxH: number };
}

const DPI_RASTER = { good: 300, min: 150 } as const;

type ProfileBody = Omit<PrintMethodProfile, 'id' | 'label'>;

const BODIES: Record<SalesPrintMethod, ProfileBody> = {
  silkscreen: { short: 'Шёлк', colorMode: 'spot', pantone: true, dpi: { ...DPI_RASTER }, size: { minMm: 30, maxW: 400, maxH: 500 } },
  embroidery: {
    short: 'Вышивка', colorMode: 'spot', pantone: true, detail: { minLineMm: 1, minTextMm: 4 },
    size: { minMm: 15, maxW: 300, maxH: 300 },
  },
  dtf: { short: 'DTF', colorMode: 'cmyk', pantone: false, dpi: { ...DPI_RASTER }, size: { minMm: 20, maxW: 450, maxH: 600 } },
  heat_transfer: { short: 'Флекс', colorMode: 'spot', pantone: true, dpi: { ...DPI_RASTER }, size: { minMm: 20, maxW: 400, maxH: 500 } },
  dtg: { short: 'DTG', colorMode: 'cmyk', pantone: false, dpi: { ...DPI_RASTER }, size: { minMm: 20, maxW: 400, maxH: 450 } },
  sublimation: { short: 'Сублим.', colorMode: 'cmyk', pantone: false },
  patch: { short: 'Шеврон', colorMode: 'spot', pantone: true },
  other: { short: 'Прочее', colorMode: 'cmyk', pantone: false },
};

export const PRINT_METHOD_PROFILES: Record<SalesPrintMethod, PrintMethodProfile> = Object.fromEntries(
  METHOD_ORDER.map((m) => [m, { id: m, label: METHOD_LABELS[m], ...BODIES[m] }]),
) as Record<SalesPrintMethod, PrintMethodProfile>;

/** Профиль техники; неизвестная или пустая — шелкография */
export function printMethodProfile(m: SalesPrintMethod | undefined | null): PrintMethodProfile {
  return (m && PRINT_METHOD_PROFILES[m]) || PRINT_METHOD_PROFILES[DEFAULT_PRINT_METHOD];
}

// ── Сроки ─────────────────────────────────────────────────────────────────

/**
 * Срок нанесения по технике, рабочих дней (веха 5в, Э6: «+N дней» в КП;
 * черновик — подтверждает производство). `null` — по договорённости (подряд).
 */
export const METHOD_LEAD_DAYS: Record<SalesPrintMethod, number | null> = {
  silkscreen: 7,
  embroidery: 7,
  dtf: 3,
  heat_transfer: 3,
  dtg: 3,
  sublimation: 5,
  patch: 10,
  other: null,
};

/** Срок нанесений позиции или заказа: наибольший из техник; техник со сроком нет — `null` */
export function leadDaysOf(methods: readonly SalesPrintMethod[]): number | null {
  const days = methods.map((m) => METHOD_LEAD_DAYS[m]).filter((d): d is number => d !== null);
  return days.length ? Math.max(...days) : null;
}

// ── Пределы размера ───────────────────────────────────────────────────────

export interface MethodSizeIssue {
  /** `min` — мельче, чем техника пропечатает (блокирует отправку); `max` — больше рамки (подсказка) */
  kind: 'min' | 'max';
  text: string;
}

/**
 * Выходит ли Ш×В за пределы техники. Без пределов у техники или без обоих
 * размеров — `null`. Минимум — по меньшей стороне, максимум — с поворотом.
 */
export function methodSizeIssue(
  method: SalesPrintMethod | undefined | null,
  w: number | null | undefined,
  h: number | null | undefined,
): MethodSizeIssue | null {
  const size = method ? PRINT_METHOD_PROFILES[method]?.size : undefined;
  if (!size || !w || !h || w <= 0 || h <= 0) return null;
  const label = METHOD_LABELS[method as SalesPrintMethod];
  const mm = (v: number) => Math.round(v * 10) / 10;
  const now = `сейчас ${mm(w)} × ${mm(h)} мм`;
  if (Math.min(w, h) < size.minMm) {
    return { kind: 'min', text: `техника «${label}»: меньшая сторона — от ${size.minMm} мм, ${now}` };
  }
  const fits = (w <= size.maxW && h <= size.maxH) || (h <= size.maxW && w <= size.maxH);
  if (!fits) {
    return { kind: 'max', text: `техника «${label}»: не больше ${size.maxW} × ${size.maxH} мм, ${now}` };
  }
  return null;
}

// ── Визард ↔ Order ────────────────────────────────────────────────────────

/** Техники визарда v3 — ключи `zoneTechs`, `allowedTechs`, `allowedZoneTechs` */
export type WizardTech = 'screen' | 'flex' | 'dtg' | 'embroidery' | 'dtf';

export const TECH_TO_METHOD: Record<WizardTech, SalesPrintMethod> = {
  screen: 'silkscreen',
  flex: 'heat_transfer',
  dtg: 'dtg',
  embroidery: 'embroidery',
  dtf: 'dtf',
};

/** Обратно; у сублимации, шевронов и прочего техники визарда нет */
export const METHOD_TO_TECH: Partial<Record<SalesPrintMethod, WizardTech>> = {
  silkscreen: 'screen',
  heat_transfer: 'flex',
  dtg: 'dtg',
  embroidery: 'embroidery',
  dtf: 'dtf',
};

// ── Техника в зоне ────────────────────────────────────────────────────────

/** Зона флэта в той мере, в какой её читает выбор техники */
export interface MethodArea {
  zone_id?: string | null;
  default_method?: SalesPrintMethod;
  methods?: SalesPrintMethod[];
}

/** Правила категории (`getEffectiveRules`) — техники в ключах визарда; `null` — без ограничений */
export interface MethodRules {
  allowedTechs: string[] | null;
  allowedZoneTechs: Record<string, string[]> | null;
}

/** Допустима ли техника в зоне: списка нет или он пуст — допустимы все */
export function methodAllowedInZone(area: Pick<MethodArea, 'methods'> | undefined, method: SalesPrintMethod): boolean {
  const ms = area?.methods;
  return !ms || ms.length === 0 || ms.includes(method);
}

/**
 * Разрешено ли правилами категории. Правила записаны техниками визарда,
 * поэтому сублимацию, шевроны и прочее они не ограничивают.
 */
function allowedByRules(method: SalesPrintMethod, zoneId: string | null | undefined, rules: MethodRules | null): boolean {
  const tech = METHOD_TO_TECH[method];
  if (!rules || !tech) return true;
  if (rules.allowedTechs && !rules.allowedTechs.includes(tech)) return false;
  const zoneTechs = zoneId ? rules.allowedZoneTechs?.[zoneId] : undefined;
  return !zoneTechs || zoneTechs.includes(tech);
}

/** Техники, допустимые в зоне: пересечение методов зоны и правил категории, в порядке экрана */
export function allowedMethods(area: MethodArea | undefined, rules: MethodRules | null): SalesPrintMethod[] {
  return METHOD_ORDER.filter((m) => methodAllowedInZone(area, m) && allowedByRules(m, area?.zone_id, rules));
}

/** Техника нового нанесения в зоне: метод зоны → первый допустимый → шелкография */
export function defaultMethod(area: MethodArea | undefined, rules: MethodRules | null): SalesPrintMethod {
  const allowed = allowedMethods(area, rules);
  if (area?.default_method && allowed.includes(area.default_method)) return area.default_method;
  return allowed[0] ?? DEFAULT_PRINT_METHOD;
}

/** Действующая техника: заданная у нанесения важнее зоны */
export function resolveMethod(
  printMethod: SalesPrintMethod | undefined | null,
  area: MethodArea | undefined,
  rules: MethodRules | null,
): SalesPrintMethod {
  return printMethod || defaultMethod(area, rules);
}
