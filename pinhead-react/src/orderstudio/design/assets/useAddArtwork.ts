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
 * Не загрузилось — нанесение не создаётся. Заказ и позиция запоминаются ДО
 * загрузки: сменили позицию (или заказ стал не черновиком), пока файл шёл, —
 * нанесение не создаётся (файл остаётся в бакете «ничьим»; уборка — бэклог
 * вехи 5а, как и после удаления нанесения).
 */
import { useCallback, useState } from 'react';
import { ARTWORK_MAX_BYTES, removeArtwork, uploadArtwork, uploadArtworkPreview } from '../../api/artworks';
import { defaultMethod, type MethodRules } from '../../model/printMethods';
import { toast } from '../../../store/useToastStore';
import type { ZoneDefinition } from '../../../types/catalog';
import type { AssetMeta, DesignView, GarmentFlat } from '../types';
import { defaultAreaId, placeArtwork, type PlaceArtworkOpts } from '../model/placeArtwork';
import type { OrderArtwork } from '../model/orderArtworks';
import { useDesignStore } from '../store/useDesignStore';
import { loadAsset } from './loadAsset';
import { primeArtworkImage } from './artworkImages';

/** Куда ставится логотип: заказ и позиция (как привязан стор дизайна), флэт и вид холста */
export interface ArtworkTarget {
  orderId: string;
  itemKey: string;
  flat: GarmentFlat;
  view: DesignView;
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
export const MSG_TARGET_CHANGED = 'Позиция сменилась, пока файл загружался, — логотип на изделие не поставлен';
export const MSG_NO_AREA = 'На этом виде нет зоны нанесения — выберите другой вид';
export const MSG_NOT_PLACED = 'Логотип не поставлен на изделие — попробуйте ещё раз';

/** Стор дизайна всё ещё на этой позиции, и её можно править */
function stillTarget(t: ArtworkTarget): boolean {
  const ds = useDesignStore.getState();
  return ds.orderId === t.orderId && ds.itemKey === t.itemKey && ds.canEdit();
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
  const { loadPdf } = await import('./loadPdf');
  const pdf = await loadPdf(loaded.bytes, file.name);
  if (!pdf.ok) {
    toast.error(pdf.error);
    return null;
  }
  return { meta: pdf.asset.meta, display: pdf.asset.png, preview: pdf.asset.png };
}

/** Поставить файл бакета на позицию одним `commit`; ключ нового нанесения либо `null` */
function placeOnItem(path: string, asset: AssetMeta, t: ArtworkTarget, opts: AddArtworkOpts): string | null {
  if (!stillTarget(t)) {
    toast.error(MSG_TARGET_CHANGED);
    return null;
  }
  const areas = t.flat.views.find((v) => v.kind === t.view)?.print_areas ?? [];
  const areaId = (opts.areaId && areas.some((a) => a.id === opts.areaId) ? opts.areaId : null) ?? defaultAreaId(t.flat, t.view);
  const area = areas.find((a) => a.id === areaId);
  if (!areaId || !area) {
    toast.error(MSG_NO_AREA);
    return null;
  }
  const placed: { key: string | null } = { key: null };
  const ds = useDesignStore.getState();
  const written = ds.commit('Логотип', (item) => {
    const res = placeArtwork(item.prints, asset, path, areaId, {
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
  if (!stillTarget(t)) {
    toast.error(MSG_READ_ONLY);
    return null;
  }
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
  void primeArtworkImage(path, prepared.meta.has_preview, prepared.display);
  return placeOnItem(path, prepared.meta, t, opts);
}

/** «Логотипы заказа»: файл уже в бакете заказа — поставить без загрузки */
export function addExistingArtwork(entry: OrderArtwork, t: ArtworkTarget, opts: AddArtworkOpts = {}): string | null {
  return placeOnItem(entry.path, entry.asset, t, opts);
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
