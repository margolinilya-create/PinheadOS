/**
 * Справочник флэтов для вкладки «Дизайн» (веха 5а, задача 5; проверка
 * скиллами: `garmentFlats` не в общем `loadAllCatalogs` — дизайн читает его сам).
 *
 * - свежий запрос `fetchCatalogKey('app_config', 'garmentFlats')` (ошибка —
 *   тост там же, здесь `status: 'error'`);
 * - разбор — терпимый `parseFlatsCatalog`: битый флэт отбрасывается и
 *   попадает в `issues`, экран не падает; клиент справочнику не доверяет
 *   (формула пути SVG, границы — M5);
 * - схема (`flatsSchema`) грузится `import()` вместе с запросом: её же
 *   читает вкладка «Флэты и зоны», а холсту она нужна один раз на открытие
 *   (бюджет холста, README модуля);
 * - кэш — 10 минут на вкладку браузера; пустой справочник не кэшируется
 *   (после «Загрузить типовые флэты» вкладка увидит их при следующем
 *   открытии); `reload()` — свежий запрос; выход сбрасывает кэш.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { registerAppReset } from '../../../store/appReset';
import type { GarmentFlatsCatalog } from '../types';

export const FLATS_CACHE_MS = 10 * 60 * 1000;

const EMPTY: GarmentFlatsCatalog = { version: 1, flats: [] };

export interface FlatsCatalogLoad {
  catalog: GarmentFlatsCatalog;
  /** Замечания разбора по-русски (битые флэты отброшены) */
  issues: string[];
}

export interface FlatsCatalogState extends FlatsCatalogLoad {
  status: 'loading' | 'ready' | 'error';
  reload: () => void;
}

let cache: (FlatsCatalogLoad & { at: number }) | null = null;
let inFlight: Promise<FlatsCatalogLoad | null> | null = null;
/** Метка выхода: ответ, запрошенный до сброса, в кэш не ложится */
let epoch = 0;

function fresh(): FlatsCatalogLoad | null {
  return cache && Date.now() - cache.at < FLATS_CACHE_MS ? cache : null;
}

/** Справочник флэтов: из кэша или свежим запросом. Ошибка запроса — `null` (тост уже показан) */
export function loadFlatsCatalog(opts: { force?: boolean } = {}): Promise<FlatsCatalogLoad | null> {
  const hit = opts.force ? null : fresh();
  if (hit) return Promise.resolve(hit);
  if (inFlight) return inFlight;
  const myEpoch = epoch;
  inFlight = (async () => {
    const [row, schema] = await Promise.all([fetchCatalogKey('app_config', 'garmentFlats'), import('./flatsSchema')]);
    if (!row) return null;
    const parsed = row.exists ? schema.parseFlatsCatalog(row.value) : { catalog: EMPTY, issues: [] };
    const loaded: FlatsCatalogLoad = { catalog: parsed.catalog, issues: parsed.issues };
    if (myEpoch === epoch && loaded.catalog.flats.length > 0) cache = { ...loaded, at: Date.now() };
    return loaded;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

function resetFlatsCatalog(): void {
  cache = null;
  inFlight = null;
  epoch += 1;
}

registerAppReset(resetFlatsCatalog);

/** Только для тестов */
export function __resetFlatsCatalogForTests(): void {
  resetFlatsCatalog();
}

type Loaded = { status: FlatsCatalogState['status'] } & FlatsCatalogLoad;

export function useFlatsCatalog(): FlatsCatalogState {
  const [state, setState] = useState<Loaded>(() => {
    const hit = fresh();
    return hit ? { status: 'ready', ...hit } : { status: 'loading', catalog: EMPTY, issues: [] };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    void loadFlatsCatalog({ force: nonce > 0 }).then((res) => {
      if (!active) return;
      setState(res ? { status: 'ready', ...res } : { status: 'error', catalog: EMPTY, issues: [] });
    });
    return () => { active = false; };
  }, [nonce]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    setNonce((n) => n + 1);
  }, []);

  return { ...state, reload };
}
