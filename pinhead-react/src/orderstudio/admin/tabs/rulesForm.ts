/**
 * Чистая логика вкладок «Упаковка», «Правила цены», «Подвал ТЗ» (веха 4,
 * задача 5). Проверки — зеркало проверки сервера (`prices_rule_check`,
 * `catalog_value_check` миграции G): экран не даёт отправить то, что сервер
 * отклонит, и называет причину у поля.
 */
import { PACK_OPTIONS_SEED, TZ_SETTINGS_SEED } from '../../catalog/seeds';
import type { PackKey, PackOption, TzSettings } from '../../catalog/types';
import { SALES_PRINT_METHODS } from '../../model/types';
import type { SalesPrintMethod } from '../../model/types';

/** Значение поля ввода числа: пусто — `''` (ещё не введено), иначе число */
export type NumberDraft = number | '';

export interface PackRow {
  key: PackKey;
  name: string;
  price: NumberDraft;
}

type Prices = Record<string, unknown> | null | undefined;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Число из поля ввода: пусто — `''`, не число — `''` */
export function parseNumberInput(raw: string): NumberDraft {
  if (raw.trim() === '') return '';
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : '';
}

/**
 * Строки упаковки: ровно 4 вида CHECK ERP в порядке сида; подпись и цена —
 * из `prices.packOptions`, вида там нет — из сида.
 */
export function packRows(prices: Prices): PackRow[] {
  const list = isObj(prices) && Array.isArray(prices.packOptions) ? (prices.packOptions as Partial<PackOption>[]) : [];
  return PACK_OPTIONS_SEED.map((seed) => {
    const hit = list.find((o) => o && o.key === seed.key);
    return {
      key: seed.key,
      name: typeof hit?.name === 'string' ? hit.name : seed.name,
      price: typeof hit?.price === 'number' ? hit.price : (hit ? '' : seed.price),
    };
  });
}

/** Ошибка строки упаковки или пусто */
export function packRowError(row: PackRow): string {
  if (row.name.trim() === '') return 'Впишите подпись — её видит менеджер в заказе';
  if (row.price === '' || row.price < 0) return 'Цена — число не меньше 0';
  return '';
}

export function packInvalid(rows: PackRow[]): boolean {
  return rows.some((r) => packRowError(r) !== '');
}

/** Порог маржи для поля: пусто — «не предупреждать» */
export function marginOf(prices: Prices): NumberDraft {
  const v = isObj(prices) ? prices.minMarginPct : null;
  return typeof v === 'number' ? v : '';
}

export function marginError(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return 'Процент от 0 до 100 или пусто';
  return '';
}

/** Подготовка по методу: нет ключа — пусто (0 ₽) */
export function prepOf(prices: Prices): Partial<Record<SalesPrintMethod, NumberDraft>> {
  const raw = isObj(prices) && isObj(prices.prepFees) ? prices.prepFees : {};
  const out: Partial<Record<SalesPrintMethod, NumberDraft>> = {};
  for (const m of SALES_PRINT_METHODS) {
    const v = raw[m];
    if (typeof v === 'number') out[m] = v;
  }
  return out;
}

export function prepError(v: unknown): string {
  if (v === undefined || v === '') return '';
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'Сумма — число не меньше 0';
  return '';
}

/**
 * Подготовка с правкой одного метода: пусто — ключ убирается (0 ₽), иначе
 * число. Ключи вне `SALES_PRINT_METHODS` не сохраняются: сервер их отклонит.
 */
export function withPrep(prices: Prices, method: SalesPrintMethod, v: NumberDraft): Record<string, number> {
  const cur = prepOf(prices);
  const next: Record<string, number> = {};
  for (const m of SALES_PRINT_METHODS) {
    const val = m === method ? v : cur[m];
    if (typeof val === 'number') next[m] = val;
  }
  return next;
}

/** Подвал ТЗ — лимит проверки сервера */
export const FOOTER_MAX = 2000;

export function footerOf(tz: unknown): string {
  return isObj(tz) && typeof tz.footerText === 'string' ? tz.footerText : TZ_SETTINGS_SEED.footerText;
}

/** Настройки ТЗ с новым подвалом; прочие поля настроек сохраняются */
export function withFooter(tz: unknown, footerText: string): TzSettings {
  return { ...(isObj(tz) ? tz : {}), footerText } as TzSettings;
}

/** Сохранять можно только поверх прочитанной из базы версии (`useCatalogEditor`) */
export const SAVABLE: readonly string[] = ['ready', 'error'];

/** Поля вкладки открыты для правки: справочник прочитан из базы, не идёт запись, не телефон */
export function canEdit(editor: { state: string }, readOnly: boolean): boolean {
  return !readOnly && ['ready', 'error', 'conflict'].includes(editor.state);
}
