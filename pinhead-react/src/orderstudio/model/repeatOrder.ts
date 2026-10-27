/**
 * «Повторить заказ» (веха 5в, Э8) — чистая модель: что из заказа-источника
 * переходит в новый черновик и как переписываются ключи и пути файлов.
 *
 * - Шапка: клиент, название, упаковка, стикеры, доставка, срочность, скидка,
 *   комментарий для цехов; `parent_id` — источник. НЕ переходят: номер, статус,
 *   срок, оплаты, сделка Bitrix, служебные отметки (их пишут только RPC).
 * - Тело: у позиций, нанесений, бирок и карточек — новые ключи; карточка позиции
 *   ссылается на новую позицию; PDF ТЗ не копируется (собирается при отправке).
 * - Два шага (ревью плана Э8): черновик создаётся сразу с телом БЕЗ файлов
 *   (`repeatDraft`: пути пустые, у нанесения с файлом нет раскладки — оно в «Не
 *   размещены»), затем файлы копируются в папку нового заказа и привязываются
 *   по новым ключам (`attachFiles`). Не скопировался — ссылки нет и счёт в
 *   `dropped` (файл, видимый приложенным, обязан быть в бакете). Прервался
 *   повтор — остаётся черновик с позициями без файлов, а не пустышка.
 */
import { newSalesItem, newSalesLabel, newSalesNoteCard, newSalesPrint } from './factory';
import type { SalesOrder } from './types';

export { repointPath } from './orderPaths';

/** Поля шапки нового черновика */
export function repeatHeader(src: SalesOrder): Partial<SalesOrder> {
  return {
    kind: src.kind,
    parent_id: src.id,
    title: src.title,
    customer: src.customer,
    contact: src.contact,
    packaging: src.packaging,
    packaging_note: src.packaging_note,
    packaging_width_mm: src.packaging_width_mm,
    packaging_height_mm: src.packaging_height_mm,
    stickers: src.stickers,
    stickers_note: src.stickers_note,
    no_chestny_znak: src.no_chestny_znak,
    delivery_method: src.delivery_method,
    delivery_address: src.delivery_address,
    urgent: src.urgent,
    ...(src.urgent_days !== undefined ? { urgent_days: src.urgent_days } : {}),
    discount: src.discount ? { ...src.discount } : null,
    notes: src.notes,
  };
}

/** Все файлы заказа, которые переходят в повтор (без PDF ТЗ), без повторов */
export function orderFilePaths(src: SalesOrder): string[] {
  const out = new Set<string>();
  const add = (p: string | null | undefined) => { if (p) out.add(p); };
  add(src.sticker_preview_path);
  for (const it of src.items) {
    for (const p of it.prints) add(p.artwork_path);
    for (const l of it.labels) {
      l.preview_paths.forEach(add);
      add(l.attach_image_path);
    }
  }
  for (const c of src.notes_cards) add(c.image_path);
  return [...out];
}

/** Где в новом черновике лежит ссылка на файл источника (по новым ключам) */
export type FileLink =
  | { kind: 'print'; item: string; key: string; from: string; layout: unknown }
  | { kind: 'label-previews'; item: string; key: string; from: string[] }
  | { kind: 'label-attach'; item: string; key: string; from: string }
  | { kind: 'note'; key: string; from: string }
  | { kind: 'sticker'; from: string };

export interface RepeatDraft {
  /** Тело черновика без файлов: пути пустые, у нанесения с файлом раскладки нет («Не размещены») */
  seed: Pick<SalesOrder, 'items' | 'notes_cards' | 'sticker_preview_path'>;
  links: FileLink[];
}

/** Тело нового черновика с новыми ключами — сначала без файлов, ссылки на них — отдельно */
export function repeatDraft(src: SalesOrder): RepeatDraft {
  const links: FileLink[] = [];
  const itemKeys = new Map<string, string>();
  const items = src.items.map((it) => {
    const item = newSalesItem().key;
    itemKeys.set(it.key, item);
    return {
      ...it,
      key: item,
      tz_pdf_path: '',
      part_colors: { ...it.part_colors },
      size_grid: { sizes: [...it.size_grid.sizes], rows: it.size_grid.rows.map((r) => ({ ...r, sizes: { ...r.sizes } })) },
      prints: it.prints.map((p) => {
        const key = newSalesPrint().key;
        if (p.artwork_path) links.push({ kind: 'print', item, key, from: p.artwork_path, layout: p.layout });
        return { ...p, key, applied_at: null, artwork_path: '', layout: p.artwork_path ? null : p.layout };
      }),
      labels: it.labels.map((l) => {
        const key = newSalesLabel().key;
        if (l.preview_paths.length) links.push({ kind: 'label-previews', item, key, from: [...l.preview_paths] });
        if (l.attach_image_path) links.push({ kind: 'label-attach', item, key, from: l.attach_image_path });
        return { ...l, key, preview_paths: [], attach_image_path: '' };
      }),
    };
  });
  const notes_cards = src.notes_cards.map((c) => {
    const key = newSalesNoteCard().key;
    if (c.image_path) links.push({ kind: 'note', key, from: c.image_path });
    return { ...c, key, item_key: c.item_key ? itemKeys.get(c.item_key) ?? null : null, image_path: '' };
  });
  if (src.sticker_preview_path) links.push({ kind: 'sticker', from: src.sticker_preview_path });
  return { seed: { items, notes_cards, sticker_preview_path: '' }, links };
}

/**
 * Привязать скопированные файлы к черновику по новым ключам. Пути нет в карте
 * (файл не скопировался) — ссылка не ставится, нанесение остаётся «Не
 * размещено», счёт — в `dropped`. Строку, которую успели удалить, пропускаем.
 */
export function attachFiles(order: SalesOrder, links: readonly FileLink[], map: Readonly<Record<string, string>>): { order: SalesOrder; dropped: number } {
  let dropped = 0;
  const to = (p: string): string => {
    const v = map[p];
    if (!v) dropped += 1;
    return v ?? '';
  };
  const byKey = new Map<string, FileLink[]>();
  let sticker = order.sticker_preview_path;
  for (const l of links) {
    if (l.kind === 'sticker') {
      sticker = to(l.from) || sticker;
      continue;
    }
    byKey.set(l.key, [...(byKey.get(l.key) ?? []), l]);
  }
  const items = order.items.map((it) => ({
    ...it,
    prints: it.prints.map((p) => {
      const l = byKey.get(p.key)?.find((x) => x.kind === 'print');
      if (!l || l.kind !== 'print') return p;
      const path = to(l.from);
      return path ? { ...p, artwork_path: path, layout: l.layout as typeof p.layout } : p;
    }),
    labels: it.labels.map((lb) => {
      let next = lb;
      for (const l of byKey.get(lb.key) ?? []) {
        if (l.kind === 'label-previews') next = { ...next, preview_paths: l.from.map(to).filter(Boolean) };
        if (l.kind === 'label-attach') next = { ...next, attach_image_path: to(l.from) };
      }
      return next;
    }),
  }));
  const notes_cards = order.notes_cards.map((c) => {
    const l = byKey.get(c.key)?.find((x) => x.kind === 'note');
    return l && l.kind === 'note' ? { ...c, image_path: to(l.from) } : c;
  });
  return { order: { ...order, items, notes_cards, sticker_preview_path: sticker }, dropped };
}

/** Макеты с превью (PDF/AI): исходник и `.preview.png` копируются парой — холст и PDF читают только превью */
export function previewSources(src: SalesOrder): Set<string> {
  const out = new Set<string>();
  for (const it of src.items) {
    for (const p of it.prints) {
      const asset = (p.layout as { asset?: { has_preview?: unknown } } | null)?.asset;
      if (p.artwork_path && asset?.has_preview === true) out.add(p.artwork_path);
    }
  }
  return out;
}
