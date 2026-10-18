/**
 * Расхождения внутри группы ТЗ (раунд 1 ревью T2). Ключ группы (К3) не содержит
 * бирок, упаковки, подрядчика, эффектов, отступа, «на крое / на готовом» и размеров
 * нанесения — документ берёт их у ПЕРВОЙ позиции группы. Если у копии в другом
 * цвете они другие, разница в ТЗ не попадёт; чек-лист называет это пунктом.
 * Нанесения сравниваются по ключу группы (`alignPrints`), не по номеру строки.
 */
import type { SalesItem, SalesPrint } from '../../model/types';
import { alignPrints } from './tzGroups';

const trim = (s: string | null | undefined): string => (s ?? '').trim();

function labelsSig(item: SalesItem): string {
  return JSON.stringify(item.labels.map((l) => [
    l.label_type, l.variant_id, trim(l.place), trim(l.size), trim(l.comment), l.blank, trim(l.attach_scheme),
  ]));
}

function packSig(item: SalesItem): string {
  const own = !!item.packaging && item.packaging !== 'inherit';
  // «Как у заказа» — размеры и примечание берутся у заказа, поля позиции не печатаются
  return JSON.stringify(own
    ? [item.packaging, item.packaging_width_mm ?? null, item.packaging_height_mm ?? null, trim(item.packaging_note), trim(item.packaging_size)]
    : ['inherit', trim(item.packaging_size)]);
}

const PRINT_FIELDS: [string, (p: SalesPrint) => unknown][] = [
  ['подрядчик', (p) => [trim(p.contractor), p.contractor_days ?? null]],
  ['эффекты', (p) => [trim(p.special), p.effects.map(trim).filter(Boolean)]],
  ['отступ', (p) => [p.offset_mm ?? null, p.offset_from, p.offset_dir, trim(p.offset_note)]],
  ['нанесение на крое или готовом', (p) => p.on],
  ['размеры нанесения', (p) => [...p.sizes].sort()],
];

/** Что у позиций группы различается вне ключа — подписи по-русски, в постоянном порядке; пусто — всё как у первой */
export function groupDivergence(items: readonly SalesItem[]): string[] {
  const [first, ...rest] = items;
  if (!first || rest.length === 0) return [];
  const found = new Set<string>();
  for (const item of rest) {
    if (labelsSig(item) !== labelsSig(first)) found.add('бирки');
    if (packSig(item) !== packSig(first)) found.add('упаковка');
    const aligned = alignPrints(first, item);
    first.prints.forEach((p, i) => {
      const q = aligned[i];
      if (!q) return;
      for (const [name, pick] of PRINT_FIELDS) {
        if (JSON.stringify(pick(p)) !== JSON.stringify(pick(q))) found.add(name);
      }
    });
  }
  return ['бирки', 'упаковка', ...PRINT_FIELDS.map(([n]) => n)].filter((n) => found.has(n));
}
