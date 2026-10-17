/** Подписи Order v4 — одно место для экранов */
import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import type { SalesOrderStatus, SalesItemKind } from '../model/types';
import type { PriceIssue } from '../pricing/priceOrder';

export const STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: 'Расчёт',
  price_review: 'Согласование цены',
  quoted: 'КП отправлено',
  ready_to_launch: 'Готов к запуску',
  production: 'В производстве',
  done: 'Готов',
  cancel_requested: 'Запрошена отмена',
  archived: 'В архиве',
};

/** Подписи и порядок техник — единый модуль `model/printMethods` (веха 5а) */
export { METHOD_LABELS, METHOD_ORDER } from '../model/printMethods';

export const KIND_LABELS: Record<SalesItemKind, string> = {
  sku: 'Пошив по модели',
  blank: 'Бланк',
  customer: 'Давальческое',
  dev: 'Разработка',
};

/** Эффекты шелкографии — ключи прайса (`SCREEN_FX`) */
export const SCREEN_EFFECTS: { key: string; label: string }[] = [
  { key: '', label: 'Без эффекта' },
  { key: 'stone', label: 'Каменная база' },
  { key: 'puff', label: 'PUFF' },
  { key: 'metallic', label: 'Металлик' },
  { key: 'fluor', label: 'Флюр' },
];

export const EMBROIDERY_EFFECTS: { key: string; label: string }[] = [
  { key: '', label: 'Обычная нить' },
  { key: 'metallic', label: 'Металлизированная' },
  { key: 'puff', label: 'Объёмная (3D)' },
];

export const ISSUE_LABELS: Record<PriceIssue, string> = {
  no_qty: 'Сетка пуста — нет тиража',
  sku_not_found: 'Модель не найдена в прайс-каталоге — нужна ручная цена',
  kind_unpriced: 'У разработки нет формулы — нужна ручная цена',
  method_unpriced: 'У техники нет цены в конструкторе — нужна ручная цена',
  print_no_size: 'У нанесения нет размера в мм — посчитано по A4',
  print_oversize: 'Макет больше A3 — посчитано по A3',
  print_too_big: 'DTF: макет не помещается в плёнку 55 см — расчёт заблокирован',
  fabric_not_found: 'Ткань не найдена или без цены — выберите ткань из каталога',
  emb_low_qty: 'Вышивка меньше 50 шт. — тариф согласовать отдельно',
};

export const rub = (v: number | null | undefined): string =>
  v == null ? '—' : `${Math.round(v).toLocaleString('ru-RU')} ₽`;

export const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;

/**
 * Виды упаковки — те же, что у ERP (`erp_orders_packaging_check`:
 * none/bopp/zip/other; у позиции ещё `inherit`). Прежние «Индивидуальная»
 * и «Навалом» в ERP не проходили CHECK, и запуск упал бы на мосте (16.10).
 */
export const PACKAGING_OPTIONS: { key: string; label: string }[] = [
  { key: 'none', label: 'Без упаковки' },
  { key: 'bopp', label: 'БОПП пакет' },
  { key: 'zip', label: 'ЗИП пакет' },
  { key: 'other', label: 'Другая — опишите в требованиях' },
];

interface PackOptionLike { key?: unknown; name?: unknown }

/**
 * Виды упаковки с подписями из справочника (веха 4): подпись — из
 * `prices.packOptions` (его правит «Справочники заказа» → «Упаковка»),
 * набор и порядок ключей — CHECK ERP (`PACKAGING_OPTIONS`). Вида нет
 * в справочнике или подпись пуста — подпись кода; чужой ключ не попадает.
 */
export function packagingOptions(packOptions: unknown): { key: string; label: string }[] {
  const list = Array.isArray(packOptions) ? (packOptions as PackOptionLike[]) : [];
  return PACKAGING_OPTIONS.map((o) => {
    const hit = list.find((x) => x && x.key === o.key && typeof x.name === 'string' && x.name.trim() !== '');
    return { key: o.key, label: hit ? (hit.name as string) : o.label };
  });
}

/** Виды упаковки для экранов — из прайса стора, обновляются вместе с ним */
export function usePackagingOptions(): { key: string; label: string }[] {
  const packOptions = useStore((s) => (s.prices as { packOptions?: unknown } | undefined)?.packOptions);
  return useMemo(() => packagingOptions(packOptions), [packOptions]);
}

/** Подпись вида упаковки (`none`/`bopp`/`zip`/`other`) по списку `usePackagingOptions` */
export function packagingLabel(options: { key: string; label: string }[], key: string): string {
  return options.find((o) => o.key === key)?.label ?? key;
}
