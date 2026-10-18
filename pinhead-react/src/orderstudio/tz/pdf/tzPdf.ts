/**
 * Движок PDF ТЗ (веха 6+7, задача 3; К4, К5, К23). **Грузится только
 * `import()`** из загрузчика `tz/ui/tzExport.ts`: jsPDF и svg2pdf — ленивый
 * чанк `vendor-pdf` через общее ядро `design/export/pdfCore.ts`
 * (сторож `pdfGuards.test.ts`, бюджет «ТЗ PDF» в `bundle-budget-m67.mjs`).
 *
 * Сборка группы: `tzDocument` → хэш содержимого (`tzContentHash`, в имя
 * файла) → A4 со шрифтом PDF → `layoutTz` по метрикам шрифта → проверка
 * знаков (защита, если чек-лист обошли) → картинки и мокапы (`tzImages`) →
 * рисование (`drawBoxes`: тексты только текстовым API) → Blob ≤ 8 МБ.
 *
 * Детерминизм: дата создания — `issuedOn`, id файла — из хэшей; две сборки
 * одной модели дают одинаковые байты. Цен в документе нет (модель ТЗ).
 */
import type { SalesOrder } from '../../model/types';
import { MaketPdfError } from '../../design/export/maketPages';
import {
  addRaster, loadPdfFonts, newPdf, pdfBlob, svgInto, type PdfDoc, type PdfFonts,
} from '../../design/export/pdfCore';
import { layoutTz, type TzLayout } from '../model/layoutTz';
import { tzDocument } from '../model/tzDocument';
import type { TzCatalogs, TzDoc } from '../model/tzDocTypes';
import type { TzGroup } from '../model/tzGroups';
import { NO_CRYPTO_MESSAGE, defaultDigest, tzContentHash, type Digest } from '../model/tzHash';
import { assertGlyphs, drawLayout, fontMeasure, type DrawOps } from './drawBoxes';
import { DEFAULT_IMAGE_DEPS, prepareVisuals, type TzImageDeps } from './tzImages';
import { TzPdfError } from './tzPdfError';

export { TzPdfError } from './tzPdfError';

/** Предел файла ТЗ: столько же проверяет сервер при отправке (миграция J) */
export const TZ_MAX_BYTES = 8 * 1024 * 1024;

export interface TzPdfInput {
  order: SalesOrder;
  /** `buildTzPdf` — ровно одна группа; `buildAllTzPdf` — все по порядку */
  groups: TzGroup[];
  catalogs: TzCatalogs;
  /** Дата первой сборки версии, `YYYY-MM-DD` (решение 21) */
  issuedOn: string;
  /** `APP_ORIGIN` (`VITE_APP_ORIGIN`), не `location.origin` (К9) */
  appOrigin: string;
}

export interface TzPdfDeps extends TzImageDeps {
  fonts: () => Promise<PdfFonts>;
  /** sha-256; `null` — криптографии нет (не https) */
  digest: Digest | null;
  maxBytes: number;
}

function withDefaults(deps: Partial<TzPdfDeps>): TzPdfDeps {
  return { ...DEFAULT_IMAGE_DEPS, fonts: loadPdfFonts, digest: defaultDigest(), maxBytes: TZ_MAX_BYTES, ...deps };
}

const MB = 1024 * 1024;
const fmtMb = (bytes: number) => (bytes / MB).toFixed(1).replace('.', ',');

/** Шрифт не доехал — отказ ТЗ тем же текстом */
async function fontsOf(deps: TzPdfDeps): Promise<PdfFonts> {
  try {
    return await deps.fonts();
  } catch (e) {
    if (e instanceof MaketPdfError) throw new TzPdfError(e.message);
    throw e;
  }
}

async function hashOf(doc: TzDoc, digest: Digest | null): Promise<string> {
  if (!digest) throw new TzPdfError(NO_CRYPTO_MESSAGE);
  return tzContentHash(doc, digest);
}

/** Дата создания PDF — дата оформления (полночь по местному времени), а не «сейчас» */
function creationDate(issuedOn: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issuedOn);
  if (!m) throw new TzPdfError(`дата оформления «${issuedOn}» не по форме ГГГГ-ММ-ДД`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Мокап или превью не легли в PDF */
export const MSG_TZ_SCENE = 'мокап или превью ТЗ не собрались — сообщите администратору';

function drawOps(pdf: PdfDoc, doc: Document): DrawOps {
  return {
    raster: (v, box) => addRaster(pdf, { bytes: v.bytes, kind: v.type, alias: v.alias }, box),
    svg: async (markup, box) => {
      try {
        await svgInto(pdf, doc, markup, box);
      } catch (e) {
        // Ядро отказывает текстом листа макета — экрану ТЗ нужен отказ ТЗ
        if (e instanceof MaketPdfError) throw new TzPdfError(MSG_TZ_SCENE);
        throw e;
      }
    },
  };
}

interface GroupPlan { group: TzGroup; doc: TzDoc; hash12: string; layout: TzLayout }

/** Документ, хэш и раскладка группы (раскладка — по метрикам шрифта этого PDF) */
async function planGroup(input: TzPdfInput, group: TzGroup, pdf: PdfDoc, deps: TzPdfDeps): Promise<GroupPlan> {
  const doc = tzDocument(input.order, group, input.catalogs, { issuedOn: input.issuedOn, appOrigin: input.appOrigin });
  const hash12 = await hashOf(doc, deps.digest);
  const layout = layoutTz(doc, fontMeasure(pdf));
  assertGlyphs(layout);
  return { group, doc, hash12, layout };
}

/** Группы → один PDF подряд (у каждой своя нумерация страниц и подвал) */
async function render(input: TzPdfInput, groups: TzGroup[], deps: TzPdfDeps): Promise<{ blob: Blob; plans: GroupPlan[] }> {
  if (groups.length === 0) throw new TzPdfError('в заказе нет позиций для ТЗ');
  const created = creationDate(input.issuedOn);
  const fonts = await fontsOf(deps);
  const pdf = await newPdf(fonts, 'a4', 'portrait');
  const plans: GroupPlan[] = [];
  for (const g of groups) plans.push(await planGroup(input, g, pdf, deps));
  const scratch = document.implementation.createHTMLDocument('tz');
  const ops = drawOps(pdf, scratch);
  let first = 1;
  for (const p of plans) {
    const visuals = await prepareVisuals(p.layout, { orderId: input.order.id, item: p.group.items[0], catalogs: input.catalogs }, deps);
    await drawLayout(pdf, p.layout, visuals, ops, first);
    first += p.layout.pages;
  }
  pdf.setProperties({ creator: 'Pinhead', title: `ТЗ ${input.order.number || ''}`.trim() });
  pdf.setCreationDate(created);
  pdf.setFileId(plans.map((p) => p.hash12 + p.group.hash8).join('').padEnd(32, '0').slice(0, 32));
  const blob = pdfBlob(pdf);
  if (blob.size > deps.maxBytes) {
    throw new TzPdfError(`файл ТЗ ${fmtMb(blob.size)} МБ — больше ${fmtMb(deps.maxBytes)} МБ: уменьшите фото бирок, стикера и заметок`);
  }
  return { blob, plans };
}

/** PDF ТЗ одной группы: файл, хэш содержимого (`-c<hash12>` в имени) и документ */
export async function buildTzPdf(input: TzPdfInput, deps: Partial<TzPdfDeps> = {}): Promise<{ blob: Blob; hash12: string; doc: TzDoc }> {
  if (input.groups.length !== 1) throw new TzPdfError('ТЗ собирается на одну группу позиций');
  const { blob, plans } = await render(input, input.groups, withDefaults(deps));
  return { blob, hash12: plans[0].hash12, doc: plans[0].doc };
}

/** Все ТЗ заказа одним файлом — сборкой, а не склейкой (К23; только черновик — решает экран) */
export async function buildAllTzPdf(input: TzPdfInput, deps: Partial<TzPdfDeps> = {}): Promise<Blob> {
  return (await render(input, input.groups, withDefaults(deps))).blob;
}
