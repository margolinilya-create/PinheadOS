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
import { contentKind, type ArtworkKind } from '../design/assets/sniff';
import { sanitizeSvg } from '../design/assets/sanitizeSvg';
import { printFileName, rasterizePrint, type PrintFileDeps } from '../design/export/printFiles';
import { erpAttachmentKey } from './erpKeys';
import type { AttPayload, CopyDeps } from './launchFiles';

export interface PrintFileCopyDeps {
  download: CopyDeps['download'];
  /** Писатель `erp-attachments` — тот же, что у копий (`launchCopyDeps`) */
  upload: CopyDeps['upload'];
  rasterize: PrintFileDeps['rasterize'];
  randomId: () => string;
}

export const MSG_PRINT_FILE = (n: number, title: string) =>
  `Файл печати нанесения ${n} «${title}» не собрался — в производстве есть исходный макет`;
export const MSG_PRINT_TOO_BIG = (n: number, title: string) =>
  `Файл печати нанесения ${n} «${title}» больше 30 МБ — в производстве есть исходный макет`;

/**
 * Предел холста при запуске, пикселей (ревью ветки 5в): у кнопки «Файлы печати» —
 * предел настольного браузера (268 Мп ≈ 1 ГБ памяти), а запуск идёт в браузере МС
 * на критическом пути — вкладка не должна падать. Больше — следующий DPI
 * (`dpiCandidates`: 150, ниже), не влез и он — пропуск с предупреждением.
 */
export const LAUNCH_MAX_PX = 40_000_000;
/** Предел файла в `erp-attachments` (= `ERP_FILE_MAX_BYTES` писателя, `attachmentLimits`) */
const MAX_BYTES = 30 * 1024 * 1024;

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
        if (!blob || !bytes) {
          warnings.push(MSG_PRINT_FILE(index + 1, title));
          continue;
        }
        // PDF/AI, EPS/PS и прочее — печать по исходнику (он уже скопирован), без предупреждения
        if (!kind || !RASTER.includes(kind)) continue;
        let src: Blob | string = blob;
        if (kind === 'svg') {
          const clean = sanitizeSvg(new TextDecoder().decode(bytes), 'asset');
          if (!clean.ok) {
            warnings.push(MSG_PRINT_FILE(index + 1, title));
            continue;
          }
          src = clean.svg;
        }
        const capped: PrintFileDeps['rasterize'] = (s, k, pw, ph) => (pw * ph > LAUNCH_MAX_PX ? Promise.resolve(null) : deps.rasterize(s, k, pw, ph));
        const res = await rasterizePrint(src, kind, w, h, capped);
        if (res && res.png.length > MAX_BYTES) {
          warnings.push(MSG_PRINT_TOO_BIG(index + 1, title));
          continue;
        }
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
