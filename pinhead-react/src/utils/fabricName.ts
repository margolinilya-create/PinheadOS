import { FABRIC_NAMES } from '../data';

interface FabricLike {
  code: string;
  name?: string;
  density?: number | string | null;
}

/**
 * Название ткани для показа: из каталога (`catalog_config.fabricsCatalog`),
 * затем из прежнего словаря `FABRIC_NAMES`, и только потом код. Каталог
 * с правки 13.10 держит ткани кодами вида `medas-kulirnaya-100-160`, которых
 * в словаре нет, — шаги «Позиции» и «Итог» показывали код (обход 16.10).
 */
export function fabricDisplayName(code: string | null | undefined, catalog: FabricLike[] | null | undefined): string {
  if (!code) return '';
  const f = (catalog ?? []).find((x) => x.code === code);
  if (f?.name) return f.density ? `${f.name}, ${f.density} г/м²` : f.name;
  return (FABRIC_NAMES as Record<string, string>)[code] || code;
}

/** Надбавка за штуку для показа: целые рубли с разрядами («+1 123 ₽/шт», не «+1122.6») */
export function fmtPerUnit(v: number): string {
  return `+${Math.round(v).toLocaleString('ru-RU')} ₽/шт`;
}
