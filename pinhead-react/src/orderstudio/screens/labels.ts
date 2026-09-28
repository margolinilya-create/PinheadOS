/** Подписи Order v4 — одно место для экранов */
import type { SalesOrderStatus, SalesPrintMethod, SalesItemKind } from '../model/types';
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

export const METHOD_LABELS: Record<SalesPrintMethod, string> = {
  silkscreen: 'Шелкография',
  embroidery: 'Вышивка',
  dtf: 'DTF',
  heat_transfer: 'Флекс / термоперенос',
  dtg: 'DTG',
  sublimation: 'Сублимация',
  patch: 'Шевроны / нашивки',
};

export const METHOD_ORDER: SalesPrintMethod[] = [
  'silkscreen', 'embroidery', 'dtf', 'heat_transfer', 'dtg', 'sublimation', 'patch',
];

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
};

export const rub = (v: number | null | undefined): string =>
  v == null ? '—' : `${Math.round(v).toLocaleString('ru-RU')} ₽`;

export const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;
