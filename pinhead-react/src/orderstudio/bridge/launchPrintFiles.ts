/**
 * Файлы печати при запуске (веха 5в, Э4б): PNG 300 dpi в натуральную величину
 * на каждое нанесение с растровым или SVG-макетом и мм — вложением вида `print`
 * к тому же нанесению ERP, рядом с копией исходного макета (`launchFiles.ts`).
 *
 * Без миграции и без правок ERP: файл кладёт писатель `api/erpFiles.ts` (тип по
 * сигнатуре байт) с ключом этой попытки запуска (`erpAttachmentKey`), заказ ERP
 * получает его в тех же `attachments` `createOrder`. Рендер — тот же, что у кнопки
 * «Файлы печати» (`rasterizePrint`): размер — Ш×В нанесения, без поворота.
 *
 * Шаг НЕОБЯЗАТЕЛЬНЫЙ: исходный макет уже скопирован, поэтому сбой (холст браузера
 * не удержал размер, файл не загрузился) запуск не останавливает — нанесение
 * пропускается, МС получает предупреждение. PDF/AI не растеризуются: печать — по
 * исходнику, он уже в ERP. Функция не бросает.
 */
import type { SalesOrder } from '../model/types';
import type { DraftItem } from '../../erp/utils/orderForm';
import type { ErpFileType, ErpUploadResult } from '../api/erpFiles';
import { contentKind, type ArtworkKind } from '../design/assets/sniff';
import { sanitizeSvg } from '../design/assets/sanitizeSvg';
import { printFileName, rasterizePrint, type PrintFileDeps } from '../design/export/printFiles';
import { erpAttachmentKey } from './erpKeys';
import type { AttPayload } from './launchFiles';

export interface PrintFileCopyDeps {
  download: (orderId: string, path: string) => Promise<Blob | null>;
  upload: (path: string, body: Blob, contentType: ErpFileType) => Promise<ErpUploadResult>;
  rasterize: PrintFileDeps['rasterize'];
  randomId: () => string;
}

export const MSG_PRINT_FILE = (n: number, title: string) =>
  `Файл печати нанесения ${n} «${title}» не собрался — в производстве есть исходный макет`;

const RASTER: readonly ArtworkKind[] = ['png', 'jpeg', 'webp', 'svg'];

/** Вложения файлов печати и предупреждения о пропущенных; `draftItems` — позиции `createOrder` */
export async function launchPrintFiles(
  order: SalesOrder, draftItems: readonly DraftItem[], attemptId: string, deps: PrintFileCopyDeps,
): Promise<{ attachments: AttPayload[]; warnings: string[] }> {
  const byKey = new Map(order.items.map((it) => [it.key, it]));
  const attachments: AttPayload[] = [];
  const warnings: string[] = [];
  for (const [itemIndex, d] of draftItems.entries()) {
    const item = d.key ? byKey.get(d.key) : undefined;
    if (!item) continue;
    const title = item.product_type.trim() || `Позиция ${itemIndex + 1}`;
    for (const dp of d.prints) {
      const index = item.prints.findIndex((x) => x.key === dp.key);
      const p = item.prints[index];
      const w = p?.width_mm ?? 0;
      const h = p?.height_mm ?? 0;
      if (!p?.artwork_path || !(w > 0) || !(h > 0) || !dp.key) continue;
      try {
        const blob = await deps.download(order.id, p.artwork_path);
        const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
        const kind = bytes ? contentKind(bytes) : null;
        if (!blob || !bytes || !kind) {
          warnings.push(MSG_PRINT_FILE(index + 1, title));
          continue;
        }
        if (!RASTER.includes(kind)) continue;
        let src: Blob | string = blob;
        if (kind === 'svg') {
          const clean = sanitizeSvg(new TextDecoder().decode(bytes), 'asset');
          if (!clean.ok) {
            warnings.push(MSG_PRINT_FILE(index + 1, title));
            continue;
          }
          src = clean.svg;
        }
        const res = await rasterizePrint(src, kind, w, h, deps.rasterize);
        const key = res ? erpAttachmentKey(attemptId, 'print', deps.randomId(), 'png') : '';
        const up = res ? await deps.upload(key, new Blob([res.png as BlobPart]), 'image/png') : null;
        if (!res || !up?.ok) {
          warnings.push(MSG_PRINT_FILE(index + 1, title));
          continue;
        }
        attachments.push({
          item_index: itemIndex, material_index: null, print_key: dp.key,
          file_path: key, file_name: printFileName(order.number, index, p, 'png', res.dpi), kind: 'print',
        });
      } catch (e) {
        console.error('launchPrintFiles', e);
        warnings.push(MSG_PRINT_FILE(index + 1, title));
      }
    }
  }
  return { attachments, warnings };
}
