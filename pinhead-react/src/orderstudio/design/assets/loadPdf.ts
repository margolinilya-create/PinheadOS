/**
 * Логотип PDF/AI → PNG-превью для холста (веха 5а, задача 5; проверка
 * безопасности M2, L5, L7). Перенос DM `lib/catalog/loadPdf.ts`.
 *
 * **Модуль грузится только динамически** (`import('./loadPdf')` из
 * `useAddArtwork`): pdfjs — свой ленивый чанк `vendor-pdfjs`, не в холсте
 * и не в оболочках (страж `bundle-budget`: «pdfjs» = граф этого модуля).
 *
 * - pdfjs — не legacy-сборка (`build/pdf.mjs`); воркер — ассет `?url`,
 *   запускается явно `new Worker(url, { type: 'module' })` (L5); запасного
 *   режима «воркер в главном потоке» нет — не запустился, значит ошибка;
 * - `isEvalSupported: false`, `enableXfa: false`, `maxImageSize` 16 Мп,
 *   аннотации не рисуются, внешних `cMapUrl`/`standardFontDataUrl` нет (L7);
 * - таймаут 30 с → воркер гасится и заменяется (бомба не вешает вкладку
 *   и следующий файл);
 * - **один PDF за раз** (очередь) и `destroy()` задачи ДОЖИДАЕТСЯ: в pdfjs
 *   4.10 `getDocument` на общем `workerPort`, пока прежний `destroy` не
 *   завершён, бросает «the worker is being destroyed» (несколько файлов
 *   перетаскиванием). Воркер не ответил на `destroy` за 5 с — он гасится;
 * - AI — только PDF-совместимый (начинается с `%PDF-`), иначе подсказка
 *   «Создать PDF-совместимый файл»;
 * - размер — точный, из MediaBox первой страницы (1 pt = 25,4/72 мм);
 *   превью — 300 dpi от размера, но не больше 2048 px по стороне (проверка
 *   скиллами), на белой подложке.
 *
 * DPI у PDF не записывается (`px_w` нет): превью — уменьшенный показ, а
 * исходник может быть вектором; иначе крупный векторный логотип получал бы
 * ложное «разрешение низкое».
 */
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { AssetMeta } from '../types';
import { MAX_COORD_MM, MAX_SOURCE_FILE_LEN } from '../limits';
import { MSG_AI } from './sniff';

export const PDF_TIMEOUT_MS = 30_000;
/** Сколько ждать ответа воркера на `destroy`; не ответил (занят) — воркер гасится */
export const PDF_DESTROY_WAIT_MS = 5_000;
/** Предел картинки внутри PDF, пикселей (M2) */
export const PDF_MAX_IMAGE_PX = 16_000_000;
/** Превью: плотность от размера и предел стороны */
export const PREVIEW_DPI = 300;
export const PREVIEW_MAX_PX = 2048;
const PT_TO_MM = 25.4 / 72;

export const MSG_PDF_BROKEN = 'PDF не открылся — сохраните логотип заново в PDF, PNG или SVG';
export const MSG_PDF_TIMEOUT = 'PDF обрабатывается слишком долго — сохраните логотип в PNG или SVG';
export const MSG_PDF_WORKER = 'Браузер не запустил обработку PDF — обновите страницу или загрузите PNG либо SVG';
export const MSG_PDF_PAGE = 'Страница PDF больше 5 м — сохраните логотип в настоящем размере';

export interface PdfAsset {
  meta: AssetMeta;
  /** PNG-превью первой страницы — его кладёт `uploadArtworkPreview` */
  png: Blob;
}

export type LoadPdfResult = { ok: true; asset: PdfAsset } | { ok: false; error: string };

const TIMEOUT = Symbol('timeout');

let worker: Worker | null = null;

/** Воркер pdfjs — один на вкладку, явным портом (L5) */
function ensureWorker(): boolean {
  if (worker) return true;
  try {
    worker = new Worker(workerUrl, { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
    return true;
  } catch (e) {
    console.error('loadPdf: worker', e);
    return false;
  }
}

/** Погасить воркер (бомба после таймаута, не ответил на `destroy`): следующий файл получит новый */
function dropWorker(): void {
  try {
    worker?.terminate();
  } catch (e) {
    console.error('loadPdf: terminate', e);
  }
  worker = null;
  pdfjs.GlobalWorkerOptions.workerPort = null;
}

/**
 * Уничтожить задачу и дождаться конца: пока `destroy` идёт, новый
 * `getDocument` на том же порту бросает. `stuck` (таймаут — воркер, скорее
 * всего, занят бомбой и `Terminate` не обработает) — воркер гасится сразу.
 */
async function finish(task: pdfjs.PDFDocumentLoadingTask | null, stuck: boolean): Promise<void> {
  if (!task) return;
  const destroyed = task.destroy().then(() => true, () => true);
  if (stuck) {
    dropWorker();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), PDF_DESTROY_WAIT_MS); });
  const done = await Promise.race([destroyed, late]);
  clearTimeout(timer);
  if (!done) dropWorker();
}

function startsWithPdf(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function renderFirstPage(task: pdfjs.PDFDocumentLoadingTask, fileName: string): Promise<LoadPdfResult> {
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const wMm = base.width * PT_TO_MM;
  const hMm = base.height * PT_TO_MM;
  if (!(wMm > 0 && hMm > 0)) return { ok: false, error: MSG_PDF_BROKEN };
  if (wMm > MAX_COORD_MM || hMm > MAX_COORD_MM) return { ok: false, error: MSG_PDF_PAGE };
  const targetPx = (Math.max(wMm, hMm) / 25.4) * PREVIEW_DPI;
  const viewport = page.getViewport({ scale: Math.min(targetPx, PREVIEW_MAX_PX) / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, error: MSG_PDF_BROKEN };
  // Белая подложка: у PDF часто прозрачный фон, а превью — PNG для холста и PDF макета
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  const png = await toPng(canvas);
  if (!png) return { ok: false, error: MSG_PDF_BROKEN };
  const meta: AssetMeta = {
    type: 'png',
    source_file: fileName.slice(0, MAX_SOURCE_FILE_LEN),
    intrinsic_w_mm: wMm,
    intrinsic_h_mm: hMm,
    size_estimated: false,
    has_preview: true,
  };
  return { ok: true, asset: { meta, png } };
}

async function loadPdfNow(bytes: Uint8Array, fileName: string): Promise<LoadPdfResult> {
  if (!startsWithPdf(bytes)) return { ok: false, error: MSG_AI };
  if (!ensureWorker()) return { ok: false, error: MSG_PDF_WORKER };
  let task: pdfjs.PDFDocumentLoadingTask | null = null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Копия: pdfjs передаёт буфер воркеру и отсоединяет его.
    // Внутри try: `getDocument` бросает синхронно (порт в `destroy`) — это отказ, а не исключение наружу
    task = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      enableXfa: false,
      maxImageSize: PDF_MAX_IMAGE_PX,
    });
    const timeout = new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), PDF_TIMEOUT_MS); });
    const res = await Promise.race([renderFirstPage(task, fileName), timeout]);
    if (res !== TIMEOUT) return res;
    timedOut = true;
    return { ok: false, error: MSG_PDF_TIMEOUT };
  } catch (e) {
    console.error('loadPdf', e);
    return { ok: false, error: MSG_PDF_BROKEN };
  } finally {
    clearTimeout(timer);
    await finish(task, timedOut);
  }
}

/** Очередь: следующий PDF открывается после того, как прежний уничтожен */
let queue: Promise<unknown> = Promise.resolve();

/** PDF/AI (байты уже прошли `sniffArtwork`) → превью и метаданные. Ошибка — текстом для показа, без исключения */
export function loadPdf(bytes: Uint8Array, fileName: string): Promise<LoadPdfResult> {
  const run = queue.then(() => loadPdfNow(bytes, fileName));
  queue = run.catch(() => undefined);
  return run;
}

/** Только для тестов: забыть воркер */
export function __resetPdfWorkerForTests(): void {
  worker = null;
  queue = Promise.resolve();
}
