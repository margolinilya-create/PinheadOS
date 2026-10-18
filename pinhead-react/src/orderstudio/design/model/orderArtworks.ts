/**
 * «Логотипы заказа» (веха 5а, задача 5): файлы, уже поставленные на холст
 * в любой позиции заказа, — их можно поставить ещё раз без загрузки.
 *
 * Источник — раскладки нанесений (`layout.asset`, строгий `parseLayout`):
 * у строки без раскладки нет метаданных файла (размер, тип, превью), и
 * поставить её на холст «как есть» нельзя. Один файл — одна запись (первая
 * по порядку позиций и нанесений). Путь в бакете у всех позиций заказа общий
 * (`orders/<id заказа>/…`), поэтому повторное использование проходит
 * проверку пути и на клиенте, и на сервере; удаление файла, нужного другому
 * нанесению, сторожит `artworkInUse`.
 */
import type { SalesOrder } from '../../model/types';
import type { AssetMeta } from '../types';
import { parseLayout } from './layout';

export interface OrderArtwork {
  /** Путь исходника в бакете заказа */
  path: string;
  asset: AssetMeta;
}

export function orderArtworks(order: Pick<SalesOrder, 'items'> | null | undefined): OrderArtwork[] {
  const out: OrderArtwork[] = [];
  const seen = new Set<string>();
  for (const item of order?.items ?? []) {
    for (const print of item.prints) {
      const path = print.artwork_path;
      if (!path || seen.has(path)) continue;
      const layout = parseLayout(print.layout);
      if (!layout) continue;
      seen.add(path);
      out.push({ path, asset: layout.asset });
    }
  }
  return out;
}
