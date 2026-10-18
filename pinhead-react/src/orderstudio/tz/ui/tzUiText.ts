/**
 * Тексты экрана «ТЗ и цена» (веха 6+7, задача 5): подпись группы ТЗ, размер
 * файла предпросмотра, свежесть возврата менеджеру.
 */
import { gridQty } from '../../model/factory';
import { fabricDisplayName } from '../../../utils/displayNames';
import { pluralize } from '../../../utils/i18n';
import { itemColors } from '../model/tzDocument';
import type { TzCatalogs } from '../model/tzDocTypes';
import type { TzGroup } from '../model/tzGroups';

/** «ТЗ 1 из 3: Футболка FreeFit, Кулирная гладь — 3 цвета, 150 шт.» */
export function groupTitle(g: TzGroup, cat: TzCatalogs | null): string {
  const first = g.items[0];
  const model = first.product_type.trim() || first.client_pattern.trim() || 'Изделие';
  const fabric = !first.client_fabric && first.fabric_code
    ? fabricDisplayName(first.fabric_code, (cat?.fabricsCatalog ?? []) as { code: string }[]) || first.main_fabric.trim()
    : first.main_fabric.trim();
  const colors = new Set(g.items.flatMap(itemColors)).size;
  const qty = g.items.reduce((n, it) => n + gridQty(it.size_grid), 0);
  const tail = [colors > 0 ? `${colors} ${pluralize(colors, 'цвет', 'цвета', 'цветов')}` : '', `${qty} шт.`].filter(Boolean).join(', ');
  return `ТЗ ${g.index} из ${g.total}: ${[model, fabric].filter(Boolean).join(', ')} — ${tail}`;
}

const MB = 1024 * 1024;

/** «1,2 МБ» / «320 КБ» */
export function fileSizeText(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace('.', ',')} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Возврат новее отправки: причину показываем, пока заказ не отправлен снова */
export function isFreshReturn(note: { at: string } | null | undefined, sentAt: string | null | undefined): boolean {
  if (!note) return false;
  if (!sentAt) return true;
  return new Date(note.at).getTime() > new Date(sentAt).getTime();
}
