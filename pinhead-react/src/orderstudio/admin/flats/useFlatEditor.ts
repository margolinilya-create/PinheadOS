/**
 * Редактор одного флэта (веха 5б, задача 3; К7) — состояние экрана
 * `/order-settings?tab=flats&flat=<id>` (`flat=new` — новый флэт).
 *
 * Свой хук, а не `useCatalogEditor` (К7): тот для `garmentFlats` ушёл бы в запасной
 * путь со значением стора, не сбрасывал бы кэш холста и не умеет «файлы перед
 * справочником». Из вехи 4 берутся текст конфликта, `setCatalogUnsaved` (`leaveGuard`)
 * и правило «конфликт — правки на экране, сохранение закрыто до свежей версии».
 *
 * - **Чтение:** свежий `fetchCatalogKey` мимо кэша → сырое значение (база записи),
 *   терпимый разбор; `reservedIds` — по сырым id (снятые и битые тоже заняты).
 *   Нет такого id — `missing`; запись не прошла разбор — `broken`: замечания
 *   в `issues`, `repair()` открывает её терпимо (недостающее — по умолчанию),
 *   после исправления она сохраняется обычной правкой (решение 17).
 * - **Справочник зон** для проверки — свежее чтение, не стор (там может быть
 *   запасной путь); не загрузился — `null`, только предупреждение.
 * - **`dirty`** — черновик отличается от базы или выбраны файлы; пишется
 *   в `leaveGuard`.
 * - **Конфликт** — `conflict`: черновик на месте, `save` закрыт до `reload`.
 *   `reload` не очищает выбранные файлы (решение 25): прежний черновик —
 *   в `previousDraft`, экран предлагает применить файлы к свежей записи.
 * - **Успех** — база и сырое значение = записанное, файлы очищены; новый флэт —
 *   адрес `flat=<id>` (`replace`).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { sameJson } from '../../../utils/sameJson';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import { setCatalogUnsaved } from '../../leaveGuard';
import { flatIssues, parseFlatsCatalog } from '../../design/catalog/flatsSchema';
import {
  catalogBytes, geometryChanged, mergeFlatIntoRaw, nextVersion, releaseFlat,
} from '../../design/catalog/flatVersion';
import type { ZoneLike } from '../../design/edit/flatAreas';
import { FLAT_VIEW_KINDS, type FlatView, type FlatViewKind, type GarmentFlat } from '../../design/types';
import { MSG_VERSIONS_RACE, rawIds, saveFlat, type SaveProgress } from './saveFlat';

export type FlatEditorState = 'loading' | 'ready' | 'saving' | 'conflict' | 'error' | 'broken' | 'missing';
type Files = Partial<Record<FlatViewKind, string>>;

export interface FlatEditor {
  state: FlatEditorState;
  draft: GarmentFlat | null;
  base: GarmentFlat | null;
  files: Files;
  /** Новый флэт: черновика ещё нет — экран создаёт его `setDraft(() => emptyFlat(…))` */
  setDraft(fn: (f: GarmentFlat) => GarmentFlat): void;
  setFile(kind: FlatViewKind, svg: string | null): void;
  /** Правка меняет силуэт — сохранится новой версией */
  geometry: boolean;
  /** Версия, которую получит сохранение (выпуск может уйти дальше, если номер занят) */
  nextVersion: number;
  dirty: boolean;
  progress: SaveProgress | null;
  allFlats: GarmentFlat[];
  reservedIds: Set<string>;
  /** Размер справочника после сохранения, байт UTF-8 */
  catalogBytes: number;
  zonesCatalog: ZoneLike[] | null;
  /** Замечания разбора записи (`broken`) и справочника */
  issues: string[];
  /** Текст последнего отказа сохранения */
  errorText: string | null;
  /** Черновик до «Загрузить свежую версию» (держится до сохранения) */
  previousDraft: GarmentFlat | null;
  save(): Promise<boolean>;
  reload(): void;
  /** `broken`: открыть битую запись терпимо для исправления */
  repair(): void;
}

interface Loaded {
  state: FlatEditorState;
  rawBase: unknown;
  base: GarmentFlat | null;
  draft: GarmentFlat | null;
  allFlats: GarmentFlat[];
  reservedIds: Set<string>;
  zonesCatalog: ZoneLike[] | null;
  issues: string[];
  /** Сырая битая запись (`broken`) */
  brokenRaw?: unknown;
  errorText: string | null;
  previousDraft: GarmentFlat | null;
}

const LOADING: Loaded = {
  state: 'loading', rawBase: null, base: null, draft: null, allFlats: [], reservedIds: new Set(),
  zonesCatalog: null, issues: [], errorText: null, previousDraft: null,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function tolerantView(v: unknown, kind: FlatViewKind): FlatView {
  const o = isObj(v) ? v : {};
  return {
    ...(o as object),
    kind,
    svg_path: typeof o.svg_path === 'string' ? o.svg_path : '',
    scale_mm_per_unit: typeof o.scale_mm_per_unit === 'number' ? o.scale_mm_per_unit : 1,
    anchors: isObj(o.anchors) ? (o.anchors as FlatView['anchors']) : {},
    print_areas: Array.isArray(o.print_areas) ? (o.print_areas as FlatView['print_areas']) : [],
  };
}

/**
 * Битая запись → черновик для исправления: известные поля как есть, недостающие
 * и неверного типа — по умолчанию. Проверка при сохранении покажет, что осталось
 */
export function tolerantFlat(raw: unknown, id: string): GarmentFlat {
  const o = isObj(raw) ? raw : {};
  const views = (Array.isArray(o.views) ? o.views : [])
    .filter((v) => isObj(v) && (FLAT_VIEW_KINDS as readonly unknown[]).includes(v.kind))
    .map((v) => tolerantView(v, (v as { kind: FlatViewKind }).kind));
  const version = Number.isInteger(o.version) && (o.version as number) >= 1 ? (o.version as number) : 1;
  const sizes = strings(o.sizes);
  return {
    ...(o as object),
    id,
    name: typeof o.name === 'string' && o.name ? o.name : id,
    garment_type: (typeof o.garment_type === 'string' ? o.garment_type : 'tshirt') as GarmentFlat['garment_type'],
    typical: typeof o.typical === 'boolean' ? o.typical : true,
    active: typeof o.active === 'boolean' ? o.active : false,
    version,
    sku_codes: strings(o.sku_codes),
    categories: strings(o.categories),
    fits: strings(o.fits),
    base_size: typeof o.base_size === 'string' ? o.base_size : (sizes[0] ?? ''),
    sizes,
    views,
    ...(Array.isArray(o.history) ? { history: o.history as GarmentFlat['history'] } : {}),
  } as GarmentFlat;
}

/** Справочник зон из свежего чтения: строки нет — встроенный; не загрузился или не список — `null` */
function zonesOf(res: { exists: boolean; value: unknown } | null): ZoneLike[] | null {
  if (!res) return null;
  if (!res.exists) return ZONES_CATALOG_DEFAULT as unknown as ZoneLike[];
  return Array.isArray(res.value) ? (res.value as ZoneLike[]) : null;
}

async function load(flatId: string): Promise<Loaded> {
  const [row, zones] = await Promise.all([
    fetchCatalogKey('app_config', 'garmentFlats'),
    fetchCatalogKey('app_config', 'zonesCatalog'),
  ]);
  const zonesCatalog = zonesOf(zones);
  if (!row) return { ...LOADING, state: 'error', zonesCatalog, errorText: 'Справочник флэтов не загрузился' };
  const rawBase = row.exists ? row.value : null;
  const parsed = rawBase === null ? { ok: true, catalog: { version: 1 as const, flats: [] }, issues: [] } : parseFlatsCatalog(rawBase);
  const common = {
    ...LOADING, rawBase, allFlats: parsed.catalog.flats, reservedIds: rawIds(rawBase), zonesCatalog, issues: parsed.issues,
  };
  if (rawBase !== null && !(isObj(rawBase) && rawBase.version === 1 && Array.isArray(rawBase.flats))) {
    return { ...common, state: 'error', errorText: parsed.issues[0] ?? 'Справочник флэтов в базе неверной формы' };
  }
  if (flatId === 'new') return { ...common, state: 'ready' };
  const flat = parsed.catalog.flats.find((f) => f.id === flatId);
  if (flat) return { ...common, state: 'ready', base: flat, draft: flat, issues: [] };
  const raw = (isObj(rawBase) && Array.isArray(rawBase.flats) ? rawBase.flats : []).find((f) => isObj(f) && f.id === flatId);
  if (raw === undefined) return { ...common, state: 'missing', issues: [] };
  return { ...common, state: 'broken', brokenRaw: raw, issues: flatIssues(raw) };
}

export function useFlatEditor(flatId: string | 'new', skuCatalog?: readonly { code: string; category: string }[] | null): FlatEditor {
  const [data, setData] = useState<Loaded>(LOADING);
  const [files, setFiles] = useState<Files>({});
  const [progress, setProgress] = useState<SaveProgress | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [, setParams] = useSearchParams();
  const guardId = useId();
  /** Прошлое сохранение упёрлось в гонку номеров версий (К3) */
  const raceRef = useRef(false);
  /** Только что созданный флэт: смена адреса `new → id` не перечитывает справочник */
  const createdRef = useRef<string | null>(null);
  /** Черновик до «Загрузить свежую версию» — для `previousDraft` */
  const keepRef = useRef<GarmentFlat | null>(null);

  useEffect(() => {
    if (createdRef.current === flatId) {
      createdRef.current = null;
      return undefined;
    }
    let alive = true;
    void load(flatId).then((res) => {
      if (alive) setData({ ...res, previousDraft: keepRef.current });
    });
    return () => { alive = false; };
  }, [flatId, attempt]);

  const fileKinds = useMemo(() => (Object.keys(files) as FlatViewKind[]).filter((k) => files[k] !== undefined), [files]);
  const { draft, base, rawBase } = data;
  const geometry = !!draft && geometryChanged(base, draft, fileKinds);
  const version = geometry ? nextVersion(base) : (base?.version ?? 1);
  const dirty = !!draft && (fileKinds.length > 0 || !sameJson(draft, base));

  const bytes = useMemo(() => {
    if (!draft) return catalogBytes(rawBase);
    const merged = mergeFlatIntoRaw(rawBase, releaseFlat(base, draft, version));
    return catalogBytes(merged === 'bad_shape' ? rawBase : merged);
  }, [draft, base, rawBase, version]);

  useEffect(() => {
    setCatalogUnsaved(guardId, dirty);
    return () => setCatalogUnsaved(guardId, false);
  }, [guardId, dirty]);

  const setDraft = useCallback((fn: (f: GarmentFlat) => GarmentFlat) => {
    setData((d) => ({ ...d, draft: fn(d.draft as GarmentFlat) }));
  }, []);

  const setFile = useCallback((kind: FlatViewKind, svg: string | null) => {
    setFiles((f) => {
      const next = { ...f };
      if (svg === null) delete next[kind];
      else next[kind] = svg;
      return next;
    });
  }, []);

  const reload = useCallback(() => {
    // Выбранные файлы остаются; черновик — до явного сброса в `previousDraft`
    keepRef.current = data.draft ?? keepRef.current;
    setData(LOADING);
    setAttempt((n) => n + 1);
  }, [data.draft]);

  const repair = useCallback(() => {
    setData((d) => {
      if (d.state !== 'broken') return d;
      const flat = tolerantFlat(d.brokenRaw, flatId);
      return { ...d, state: 'ready', base: flat, draft: flat };
    });
  }, [flatId]);

  const save = useCallback(async (): Promise<boolean> => {
    if ((data.state !== 'ready' && data.state !== 'error') || !data.draft) return false;
    setData((d) => ({ ...d, state: 'saving', errorText: null }));
    const res = await saveFlat({
      rawBase: data.rawBase, base: data.base, draft: data.draft, files,
      zonesCatalog: data.zonesCatalog, raceRetry: raceRef.current, onProgress: setProgress, skuCatalog,
    });
    setProgress(null);
    if (!res.ok) {
      raceRef.current = res.kind === 'files' && (raceRef.current || res.message === MSG_VERSIONS_RACE);
      setData((d) => ({ ...d, state: res.kind === 'conflict' ? 'conflict' : 'error', errorText: res.message }));
      return false;
    }
    raceRef.current = false;
    keepRef.current = null;
    const saved = res.flat;
    setFiles({});
    setData((d) => ({
      ...d, state: 'ready', rawBase: res.raw, base: saved, draft: saved, previousDraft: null, errorText: null,
      allFlats: [...d.allFlats.filter((f) => f.id !== saved.id), saved],
      reservedIds: new Set([...d.reservedIds, saved.id]),
    }));
    if (flatId === 'new') {
      createdRef.current = saved.id;
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('flat', saved.id);
        return next;
      }, { replace: true });
    }
    return true;
  }, [data, files, flatId, setParams, skuCatalog]);

  return {
    state: data.state, draft, base, files, setDraft, setFile, geometry, nextVersion: version, dirty, progress,
    allFlats: data.allFlats, reservedIds: data.reservedIds, catalogBytes: bytes, zonesCatalog: data.zonesCatalog,
    issues: data.issues, errorText: data.errorText, previousDraft: data.previousDraft, save, reload, repair,
  };
}
