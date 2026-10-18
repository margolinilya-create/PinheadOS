/**
 * Шаг `files` запуска (веха 6+7, К12): копии PDF ТЗ и макетов в `erp-attachments`.
 *
 * - **ТЗ — своя копия на каждую позицию ERP** (снятие ТЗ у одной позиции в ERP
 *   не удаляет файл у остальных). PDF группы скачивается ОДИН раз, из одного
 *   `Blob` грузятся N копий; у каждой новый `groupId` (уникальность
 *   `(group_id, version)` в ERP и повтор запуска после возврата).
 * - **`item_index` — индекс в позициях, которые уходят в `createOrder`**
 *   (`payloadItems(draft.items)`), сопоставление по ключу позиции, а не по
 *   порядку в заказе: пустая позиция выпадает и сдвигает номера.
 * - **Ключи `print_key`/`label_key` — ровно из тех же объектов**, что уходят
 *   в `createOrder`: стор ERP переводит их в номер и молча выбрасывает
 *   неизвестные (пост-проверка — `checkAttachedCount`).
 * - **Тип файла — только по сигнатуре байт**, никогда из `Blob.type` или
 *   расширения: бакет публичный (К13), SVG со скриптом под именем `.png`
 *   исполнился бы на origin Storage. Объявленный вид (по расширению пути) обязан
 *   совпасть с байтами, иначе отказ с номером нанесения. SVG — только
 *   очищенный текст (`sanitizeSvg`), не очистился — отказ.
 * - 409 у писателя — отказ шага (не успех): повтор запуска — с новыми ключами.
 */
import type { SalesItem, SalesOrder } from '../model/types';
import type { DraftItem } from '../../erp/utils/orderForm';
import { artworkPreviewPath, downloadArtwork } from '../api/artworks';
import { ERP_FILE_MAX_BYTES, uploadErpFile, type ErpFileType, type ErpUploadResult } from '../api/erpFiles';
import { sanitizeSvg } from '../design/assets/sanitizeSvg';
import { pluralize } from '../../utils/i18n';
import { erpAttachmentKey, erpFileName, erpTzKey, type ErpAttachmentKind } from './erpKeys';

export type Declared = 'pdf' | 'raster' | 'svg' | 'ps' | 'other';
type Sniffed = 'pdf' | 'png' | 'jpeg' | 'svg' | 'ps';

export interface TzCopy { itemKey: string; itemIndex: number; source: string; groupId: string; key: string; name: string }
export interface AttCopy {
  itemKey: string; itemIndex: number; printKey?: string; labelKey?: string;
  source: string; uid: string; key: string; name: string; kind: ErpAttachmentKind; declared: Declared;
  /** Для человека: «нанесения 2 «Футболка»» */
  what: string;
  /** Превью PDF/AI: нет в бакете — не беда, исходник уже скопирован */
  optional?: boolean;
}
export interface LaunchFilePlan { attemptId: string; tz: TzCopy[]; att: AttCopy[] }

export interface TzDocPayload {
  group_id: string; item_index: number; file_path: string; file_name: string;
  mime_type: 'application/pdf'; size_bytes: number; uploaded_by: string;
}
export interface AttPayload {
  item_index: number; material_index: null; print_key?: string; label_key?: string;
  file_path: string; file_name: string; kind: ErpAttachmentKind;
}

export const MSG = {
  tzNotPdf: (name: string) => `ТЗ позиции «${name}» не PDF — верните менеджеру, он отправит заново`,
  tzMissing: (name: string) => `PDF ТЗ позиции «${name}» не загружен из хранилища — повторите запуск`,
  missing: (what: string) => `Файл ${what} не загружен из хранилища — повторите запуск`,
  tooBig: (what: string) => `Файл ${what} больше 20 МБ — производство его не примет. Верните заказ менеджеру, чтобы он заменил файл`,
  mismatch: (what: string) => `Содержимое файла ${what} не совпадает с его типом — верните заказ менеджеру, чтобы он заменил файл`,
  format: (what: string) => `Файл ${what} в формате, который производство не принимает (PDF, PNG, JPG, SVG, PS) — верните заказ менеджеру`,
  svg: (what: string) => `SVG ${what} не прошёл очистку — верните заказ менеджеру, чтобы он сохранил файл в PNG или PDF`,
  attached: (n: number) => `${n} ${pluralize(n, 'макет не привязался', 'макета не привязались', 'макетов не привязались')} к нанесениям и биркам — проверьте в производстве`,
} as const;

const EXT_DECLARED: Record<string, Declared> = {
  pdf: 'pdf', ai: 'pdf', png: 'raster', jpg: 'raster', jpeg: 'raster', svg: 'svg', ps: 'ps', eps: 'ps',
};
/** Что из байт допустимо при объявленном виде */
const ACCEPT: Record<Declared, readonly Sniffed[]> = {
  pdf: ['pdf', 'ps'], raster: ['png', 'jpeg'], svg: ['svg'], ps: ['ps', 'pdf'], other: [],
};
const MIME: Record<Sniffed, ErpFileType> = {
  pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml', ps: 'application/postscript',
};
const EXT: Record<Sniffed, string> = { pdf: 'pdf', png: 'png', jpeg: 'jpg', svg: 'svg', ps: 'ps' };

/** Объявленный вид — по расширению пути в бакете заказа */
export function declaredOf(path: string): Declared {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return EXT_DECLARED[ext] ?? 'other';
}

/** Вид файла по первым байтам; не узнали — `null` */
export function sniffBytes(b: Uint8Array): Sniffed | null {
  const ascii = (n: number) => String.fromCharCode(...b.subarray(0, n));
  if (ascii(5) === '%PDF-') return 'pdf';
  if (ascii(4) === '%!PS') return 'ps';
  if (b[0] === 0x89 && ascii(4).slice(1) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart();
  return head.startsWith('<svg') || head.startsWith('<?xml') ? 'svg' : null;
}

const itemTitle = (it: SalesItem | undefined, i: number) => it?.product_type.trim() || `Позиция ${i + 1}`;

/**
 * План копий — чистая функция. `draftItems` — позиции, которые уходят
 * в `createOrder` (уже без пустых): номер позиции ERP — индекс в них.
 */
export function planLaunchFiles(order: SalesOrder, draftItems: readonly DraftItem[], randomId: () => string): LaunchFilePlan {
  const attemptId = randomId();
  const byKey = new Map(order.items.map((it) => [it.key, it]));
  const tz: TzCopy[] = [];
  const att: AttCopy[] = [];
  const prefix = [order.number];
  draftItems.forEach((d, itemIndex) => {
    const item = d.key ? byKey.get(d.key) : undefined;
    if (!item) return;
    const title = itemTitle(item, itemIndex);
    const groupId = randomId();
    tz.push({ itemKey: item.key, itemIndex, source: item.tz_pdf_path, groupId, key: erpTzKey(attemptId, groupId), name: erpFileName([...prefix, title, 'TZ'], 'pdf') });
    const addFile = (kind: ErpAttachmentKind, source: string, what: string, owner: { printKey?: string; labelKey?: string }, optional = false) => {
      const declared = declaredOf(source);
      const uid = randomId();
      const ext = declared === 'raster' ? 'png' : declared === 'other' ? 'bin' : declared;
      att.push({
        itemKey: item.key, itemIndex, ...owner, source, uid, kind, declared, what, ...(optional ? { optional } : {}),
        key: erpAttachmentKey(attemptId, kind, uid, ext),
        name: erpFileName([...prefix, title, kind === 'print' ? 'nanesenie' : 'birka'], ext),
      });
    };
    d.prints.forEach((dp, n) => {
      const p = item.prints.find((x) => x.key === dp.key);
      if (!p?.artwork_path) return;
      const what = `макета нанесения ${n + 1} «${title}»`;
      addFile('print', p.artwork_path, what, { printKey: dp.key });
      if (declaredOf(p.artwork_path) === 'pdf') addFile('print', artworkPreviewPath(p.artwork_path), `превью ${what}`, { printKey: dp.key }, true);
    });
    d.labels.forEach((dl, n) => {
      const l = item.labels.find((x) => x.key === dl.key);
      for (const path of l?.preview_paths.filter(Boolean) ?? []) addFile('label', path, `превью бирки ${n + 1} «${title}»`, { labelKey: dl.key });
    });
  });
  return { attemptId, tz, att };
}

export interface CopyDeps {
  download: (orderId: string, path: string) => Promise<Blob | null>;
  upload: (path: string, body: Blob, contentType: ErpFileType) => Promise<ErpUploadResult>;
  sanitize: (text: string) => { ok: true; svg: string } | { ok: false; error: string };
}

const DEFAULT_DEPS: CopyDeps = { download: downloadArtwork, upload: uploadErpFile, sanitize: (t) => sanitizeSvg(t) };

type CopyResult = { ok: true; tzDocs: TzDocPayload[]; attachments: AttPayload[] } | { ok: false; reason: string };

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const withKey = (key: string, ext: string) => key.replace(/\.[a-z0-9]+$/, `.${ext}`);

/** Одна копия вложения: байты → вид → (SVG — очистка) → загрузка; `null` — пропущено (необязательное) */
async function copyAtt(orderId: string, a: AttCopy, deps: CopyDeps): Promise<{ path: string } | { fail: string } | null> {
  if (a.declared === 'other') return { fail: MSG.format(a.what) };
  const blob = await deps.download(orderId, a.source);
  if (!blob) return a.optional ? null : { fail: MSG.missing(a.what) };
  if (blob.size > ERP_FILE_MAX_BYTES) return { fail: MSG.tooBig(a.what) };
  const bytes = await bytesOf(blob);
  const kind = sniffBytes(bytes);
  if (!kind || !ACCEPT[a.declared].includes(kind)) return { fail: MSG.mismatch(a.what) };
  let body = new Blob([bytes]);
  if (kind === 'svg') {
    const clean = deps.sanitize(new TextDecoder().decode(bytes));
    if (!clean.ok) return { fail: MSG.svg(a.what) };
    body = new Blob([clean.svg]);
  }
  const path = withKey(a.key, EXT[kind]);
  const res = await deps.upload(path, body, MIME[kind]);
  return res.ok ? { path } : { fail: res.reason };
}

/**
 * Копирование по плану. Первый отказ останавливает шаг (решение 24): заказ
 * ERP не создаётся, загруженные копии уберёт `storage-gc`.
 */
export async function copyLaunchFiles(
  order: SalesOrder, plan: LaunchFilePlan, actor: string, deps: CopyDeps = DEFAULT_DEPS,
): Promise<CopyResult> {
  const names = new Map(order.items.map((it, i) => [it.key, itemTitle(it, i)]));
  const pdfs = new Map<string, Blob>();
  const tzDocs: TzDocPayload[] = [];
  for (const t of plan.tz) {
    const name = names.get(t.itemKey) ?? 'Позиция';
    let pdf = pdfs.get(t.source);
    if (!pdf) {
      const blob = t.source ? await deps.download(order.id, t.source) : null;
      if (!blob) return { ok: false, reason: MSG.tzMissing(name) };
      if (blob.size > ERP_FILE_MAX_BYTES) return { ok: false, reason: MSG.tooBig(`ТЗ позиции «${name}»`) };
      const bytes = await bytesOf(blob);
      if (sniffBytes(bytes) !== 'pdf') return { ok: false, reason: MSG.tzNotPdf(name) };
      pdf = new Blob([bytes]);
      pdfs.set(t.source, pdf);
    }
    const res = await deps.upload(t.key, pdf, 'application/pdf');
    if (!res.ok) return { ok: false, reason: res.reason };
    tzDocs.push({
      group_id: t.groupId, item_index: t.itemIndex, file_path: t.key, file_name: t.name,
      mime_type: 'application/pdf', size_bytes: pdf.size, uploaded_by: actor,
    });
  }
  const attachments: AttPayload[] = [];
  for (const a of plan.att) {
    const r = await copyAtt(order.id, a, deps);
    if (!r) continue;
    if ('fail' in r) return { ok: false, reason: r.fail };
    attachments.push({
      item_index: a.itemIndex, material_index: null,
      ...(a.printKey ? { print_key: a.printKey } : {}), ...(a.labelKey ? { label_key: a.labelKey } : {}),
      file_path: r.path, file_name: a.name.replace(/\.[a-z0-9]+$/, r.path.slice(r.path.lastIndexOf('.'))), kind: a.kind,
    });
  }
  return { ok: true, tzDocs, attachments };
}

/**
 * Пост-проверка после `createOrder`: стор ERP молча выбрасывает вложение с
 * неизвестным ключом. Не отказ (заказ уже создан) — предупреждение в итоге.
 */
export function checkAttachedCount(sent: readonly AttPayload[], rows: readonly { kind: string }[]): string | null {
  const got = rows.filter((r) => r.kind === 'print' || r.kind === 'label').length;
  const lost = sent.length - got;
  return lost > 0 ? MSG.attached(lost) : null;
}
