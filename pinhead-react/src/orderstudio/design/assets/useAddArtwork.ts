/**
 * «Загрузить логотип» и «Логотипы заказа» (веха 5а, задача 5).
 *
 * Файл → нанесение на холсте:
 * 1. тип и размер — по байтам (`loadAsset` → `sniffArtwork`); PSD, TIFF, EPS
 *    и прочее — отказ с подсказкой, ничего не грузится;
 * 2. PDF/AI — превью через `loadPdf` (pdfjs — только `import()` по действию);
 * 3. исходник **сразу** в бакет заказа (`uploadArtwork`, вид `logo`) — правило
 *    проекта «файл, видимый приложенным, обязан быть в бакете»;
 * 4. PDF/AI — PNG-превью рядом (`uploadArtworkPreview`, путь выводится);
 *    превью не легло — исходник убирается, нанесение не создаётся;
 * 5. картинка для холста — из уже чистого Blob, без повторного скачивания;
 * 6. нанесение — `placeArtwork` (зона по умолчанию, свой размер в пределах
 *    зоны, стандартное место; неразмещённая строка той же зоны дописывается)
 *    одним `commit` стора дизайна вместе с `flat_id` позиции.
 *
 * Не загрузилось — нанесение не создаётся. Всё, что можно проверить без
 * файла, проверяется ДО загрузки (холст на этой позиции, заказ можно править,
 * на виде есть зона): иначе файл лёг бы в бакет «ничьим». Заказ и позиция
 * запоминаются до загрузки: сменили позицию (или заказ стал не черновиком),
 * пока файл шёл, — нанесение не создаётся (файл остаётся в бакете «ничьим»;
 * уборка — бэклог вехи 5а, как и после удаления нанесения).
 */
import { useCallback, useState } from 'react';
import { ARTWORK_MAX_BYTES, removeArtwork, uploadArtwork, uploadArtworkPreview } from '../../api/artworks';
import { defaultMethod, type MethodRules } from '../../model/printMethods';
import { handlePossibleUpdate } from '../../../lib/appUpdate';
import { toast } from '../../../store/useToastStore';
import type { ZoneDefinition } from '../../../types/catalog';
import type { AssetMeta, DesignView, GarmentFlat, PrintArea } from '../types';
import { placeArtwork, type PlaceArtworkOpts } from '../model/placeArtwork';
import type { OrderArtwork } from '../model/orderArtworks';
import { useDesignStore } from '../store/useDesignStore';
import { loadAsset } from './loadAsset';
import { primeArtworkImage } from './artworkImages';

/**
 * Куда ставится логотип: заказ и позиция (как привязан стор дизайна), флэт и вид холста.
 * `flat` — флэт ВЕРСИИ ПОЗИЦИИ (`ui/useItemFlat`, К15): новое размещение на позиции
 * v1 пишет `flat_version: 1`; `view` — любой вид флэта, рукава тоже (5б)
 */
export interface ArtworkTarget {
  orderId: string;
  itemKey: string;
  flat: GarmentFlat;
  view: DesignView;
  /** Зоны модели (`zonesForSku`; служебные — всегда); `null` — без фильтра (5б, К15) */
  areaAllowed?: ((area: PrintArea) => boolean) | null;
  /** Справочник зон — имя зоны нанесения по `zone_id` (его читает цена) */
  zonesCatalog: ZoneDefinition[];
  /** Категория модели (`SkuItem.category`) — отступ штанов от пояса */
  category: string;
  /** Правила категории (`getEffectiveRules`) — техника по умолчанию в зоне */
  rules: MethodRules | null;
}

export interface AddArtworkOpts extends PlaceArtworkOpts {
  /** Зона флэта; нет или не на этом виде — зона по умолчанию */
  areaId?: string;
}

export const MSG_READ_ONLY = 'Заказ открыт только для чтения — логотип не добавлен';
export const MSG_OTHER_ITEM = 'Холст открыт на другой позиции — логотип не добавлен, повторите';
export const MSG_TARGET_CHANGED = 'Позиция сменилась, пока файл загружался, — логотип на изделие не поставлен';
export const MSG_NO_AREA = 'На этом виде нет зоны нанесения для этой модели — выберите другой вид';
export const MSG_NOT_PLACED = 'Логотип не поставлен на изделие — попробуйте ещё раз';
export const MSG_PDF_UNAVAILABLE = 'Обработка PDF не загрузилась — обновите страницу или загрузите логотип в PNG либо SVG';

/**
 * Почему на эту позицию сейчас нельзя ставить логотип; `null` — можно.
 * `moved` — текст, если стор дизайна уже на другой позиции (до загрузки и
 * после неё причина разная).
 */
function blockReason(t: ArtworkTarget, moved: string): string | null {
  const ds = useDesignStore.getState();
  if (ds.orderId !== t.orderId || ds.itemKey !== t.itemKey) return moved;
  return ds.canEdit() ? null : MSG_READ_ONLY;
}

/**
 * Зона флэта для логотипа: заданная (если она на этом виде и допустима для
 * модели) либо по умолчанию — первая допустимая со связью со справочником зон,
 * служебная — если других нет (как `defaultAreaId`); нет — `null`
 */
function resolveArea(t: ArtworkTarget, opts: AddArtworkOpts): PrintArea | null {
  const all = t.flat.views.find((v) => v.kind === t.view)?.print_areas ?? [];
  const areas = t.areaAllowed ? all.filter(t.areaAllowed) : all;
  const wanted = opts.areaId ? areas.find((a) => a.id === opts.areaId) : undefined;
  return wanted ?? areas.find((a) => a.zone_id) ?? areas[0] ?? null;
}

/** Размер растра для уменьшения показа; у SVG и превью PDF — `null` */
function rasterSize(meta: AssetMeta): { width: number; height: number } | null {
  return !meta.has_preview && meta.px_w && meta.px_h ? { width: meta.px_w, height: meta.px_h } : null;
}

interface Prepared {
  meta: AssetMeta;
  /** Чистый Blob для холста: SVG после санитайзера, растр, PNG-превью PDF */
  display: Blob;
  /** PNG-превью PDF/AI — в бакет рядом с исходником */
  preview: Blob | null;
}

async function prepare(file: File): Promise<Prepared | null> {
  const loaded = await loadAsset(file, file.name);
  if (loaded.status === 'error') {
    toast.error(loaded.error);
    return null;
  }
  if (loaded.status === 'ok') return { meta: loaded.asset.meta, display: loaded.asset.blob, preview: null };
  let mod: typeof import('./loadPdf');
  try {
    mod = await import('./loadPdf');
  } catch (e) {
    // Чанк пропал после выкладки (устаревшая вкладка) — общий диалог «Вышло обновление»
    console.error('useAddArtwork: loadPdf', e);
    if (!handlePossibleUpdate(e)) toast.error(MSG_PDF_UNAVAILABLE);
    return null;
  }
  const pdf = await mod.loadPdf(loaded.bytes, file.name);
  if (!pdf.ok) {
    toast.error(pdf.error);
    return null;
  }
  return { meta: pdf.asset.meta, display: pdf.asset.png, preview: pdf.asset.png };
}

/** Проверки до загрузки: холст на позиции, заказ можно править, на виде есть зона */
function precheck(t: ArtworkTarget, opts: AddArtworkOpts, moved: string): PrintArea | null {
  const reason = blockReason(t, moved);
  if (reason) {
    toast.error(reason);
    return null;
  }
  const area = resolveArea(t, opts);
  if (!area) toast.error(MSG_NO_AREA);
  return area;
}

/**
 * Поставить файл бакета на позицию одним `commit`; ключ нового нанесения либо
 * `null`. `moved` — текст, если стор дизайна ушёл на другую позицию.
 */
function placeOnItem(path: string, asset: AssetMeta, t: ArtworkTarget, opts: AddArtworkOpts, moved: string): string | null {
  const area = precheck(t, opts, moved);
  if (!area) return null;
  const placed: { key: string | null } = { key: null };
  const ds = useDesignStore.getState();
  const written = ds.commit('Логотип', (item) => {
    const res = placeArtwork(item.prints, asset, path, area.id, {
      flat: t.flat, zonesCatalog: t.zonesCatalog, category: t.category, view: t.view,
      itemKind: item.kind, method: defaultMethod(area, t.rules),
    }, opts);
    if (!res) return null;
    placed.key = res.key;
    // Нанесение стоит на этом флэте — он и есть флэт позиции (пустой или снятый заменяется)
    return { prints: res.prints, flat_id: t.flat.id };
  });
  if (!written || !placed.key) {
    toast.error(MSG_NOT_PLACED);
    return null;
  }
  ds.select(placed.key);
  return placed.key;
}

/** Файл с диска → бакет → нанесение. Ключ нанесения либо `null` (причина — тостом) */
export async function addArtworkFile(file: File, t: ArtworkTarget, opts: AddArtworkOpts = {}): Promise<string | null> {
  if (!precheck(t, opts, MSG_OTHER_ITEM)) return null;
  if (file.size > ARTWORK_MAX_BYTES) {
    toast.error('Файл больше 25 МБ');
    return null;
  }
  const prepared = await prepare(file);
  if (!prepared) return null;
  const path = await uploadArtwork(t.orderId, 'logo', file);
  if (!path) return null;
  if (prepared.preview && !(await uploadArtworkPreview(t.orderId, path, prepared.preview))) {
    await removeArtwork(path, { missingOk: true });
    return null;
  }
  void primeArtworkImage(path, prepared.meta.has_preview, prepared.display, rasterSize(prepared.meta));
  return placeOnItem(path, prepared.meta, t, opts, MSG_TARGET_CHANGED);
}

/** «Логотипы заказа»: файл уже в бакете заказа — поставить без загрузки */
export function addExistingArtwork(entry: OrderArtwork, t: ArtworkTarget, opts: AddArtworkOpts = {}): string | null {
  return placeOnItem(entry.path, entry.asset, t, opts, MSG_OTHER_ITEM);
}

export interface AddArtworkApi {
  addFile: (file: File, opts?: AddArtworkOpts) => Promise<string | null>;
  addExisting: (entry: OrderArtwork, opts?: AddArtworkOpts) => string | null;
  /** Идёт загрузка — кнопке `aria-busy` и «Загружаю…» */
  busy: boolean;
}

/** Хук панели и холста: `target` — `null`, пока флэта нет */
export function useAddArtwork(target: ArtworkTarget | null): AddArtworkApi {
  const [pending, setPending] = useState(0);
  const addFile = useCallback(async (file: File, opts?: AddArtworkOpts) => {
    if (!target) return null;
    setPending((n) => n + 1);
    try {
      return await addArtworkFile(file, target, opts);
    } finally {
      setPending((n) => n - 1);
    }
  }, [target]);
  const addExisting = useCallback(
    (entry: OrderArtwork, opts?: AddArtworkOpts) => (target ? addExistingArtwork(entry, target, opts) : null),
    [target],
  );
  return { addFile, addExisting, busy: pending > 0 };
}
