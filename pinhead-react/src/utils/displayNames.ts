import { FABRIC_NAMES, PRICES } from '../data';

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

interface PackOptionLike { key?: unknown; name?: unknown }

/** Подписи кода: прежний прайс плюс `other` — на случай, когда справочника нет */
const CODE_PACK_NAMES: Record<string, string> = {
  ...Object.fromEntries((PRICES.packOptions as { key: string; name: string }[]).map((o) => [o.key, o.name])),
  other: 'Другая — опишите в требованиях',
};

/**
 * Вид упаковки по-русски. Подпись — из справочника упаковки `packOptions`
 * (`prices.packOptions` стора; правит «Справочники заказа» → «Упаковка», веха 4),
 * вида там нет или подпись пуста — подпись кода; неизвестный вид — пусто.
 *
 * Справочник — аргументом, а не чтением стора: при рендере его берут подпиской
 * (`usePackagingOptions` / селектор `prices.packOptions`), иначе подпись
 * не обновится после правки упаковки. Без аргумента — подписи кода.
 */
export function packName(key: string | null | undefined, packOptions?: unknown): string {
  if (!key) return '';
  const list = Array.isArray(packOptions) ? (packOptions as PackOptionLike[]) : [];
  const hit = list.find((o) => o && o.key === key && typeof o.name === 'string' && o.name.trim() !== '');
  return hit ? (hit.name as string) : (CODE_PACK_NAMES[key] ?? '');
}
