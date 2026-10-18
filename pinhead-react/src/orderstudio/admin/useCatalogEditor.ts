/**
 * Редактор одного справочника заказа (веха 4, задача 2) — общий для вкладок
 * экрана «Справочники заказа».
 *
 * Как устроен (решения контроллера вехи 4):
 *   · справочник читается СВЕЖИМ запросом `fetchCatalogKey` — мимо кэша
 *     каталогов; прочитанное значение и есть база для записи;
 *   · запись — `putCatalog` (справочник целиком) либо, для прайса,
 *     `patchPrices` (только изменённые верхние ключи с их прежними значениями):
 *     сервер пишет, только если в базе всё ещё база — иначе конфликт;
 *   · конфликт: кэш каталогов сброшен, правки остаются на экране, сохранение
 *     закрыто до «Загрузить свежую версию» (`reload`) — свежая версия
 *     заменяет правки, их вносят заново поверх неё;
 *   · не загрузилось (сбой или строки нет) — `fallback`: показ значения стора
 *     (сиды кода), сохранение заблокировано — сиды поверх базы не пишутся;
 *   · отказ права, формы записи (22023, вид `invalid` — веха 5б) или сети —
 *     состояние `error`, правки на месте, повтор возможен; текст отказа
 *     (у формы — текст сервера дословно) — в `errorText`;
 *   · успех — стор обновлён, кэш сброшен (`putCatalog`/`patchPrices`);
 *   · несохранённые правки отмечаются в `leaveGuard` — уход со страницы
 *     и смену вкладки экран подтверждает.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { sameJson } from '../../utils/sameJson';
import { fetchCatalogKey, clearCatalogsCache } from '../../lib/catalogs';
import { putCatalog, patchPrices } from '../api/catalogAdmin';
import type { CatalogKey, CatalogTable, CatalogWriteResult } from '../api/catalogAdmin';
import { setCatalogUnsaved } from '../leaveGuard';
import { useStore } from '../../store/useStore';
import { mergePrices } from '../../store/slices/catalogSlice';
import { invalidatePricesCache } from '../../utils/pricing';

/** Текст конфликта записи (`role="alert"`): справочник ушёл вперёд, правки на экране не сохранены */
export function catalogConflictText(name: string): string {
  return `Справочник «${name}» уже изменили — в другой вкладке или другой администратор. Ваши правки не сохранены. Загрузите свежую версию и внесите их снова.`;
}

/** Текст запасного пути: справочник не загрузился, сохранение закрыто */
export const CATALOG_FALLBACK_TEXT = 'Справочник не загрузился. Заказы пока считают по встроенным значениям.';

export type CatalogEditorState = 'loading' | 'ready' | 'saving' | 'conflict' | 'error' | 'fallback';

/** Ключ прайса — пишется не целиком, а `prices_patch` по верхним ключам */
const PRICES_KEY = 'prices';

/** Ключ справочника для хука: из белого списка `catalog_put` либо прайс (`app_config`) */
export type EditorKey<T extends CatalogTable> = CatalogKey<T> | (T extends 'app_config' ? typeof PRICES_KEY : never);

type Updater<V> = V | ((prev: V) => V);

export interface CatalogEditor<V> {
  value: V;
  setValue: (next: Updater<V>) => void;
  /** Значение отличается от базы (того, что прочитано из базы) */
  dirty: boolean;
  /** true — записано; false — отказ, сохранение закрыто или нечего писать не было */
  save: () => Promise<boolean>;
  /** Свежая версия из базы; правки на экране заменяются ею */
  reload: () => void;
  state: CatalogEditorState;
  /** Текст последнего отказа записи (у формы записи — текст сервера); успех и загрузка снимают */
  errorText: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Общий для /sku и «Справочников заказа» — в utils; реэкспорт для вкладок Order
export { sameJson };

/** Поле стора каталогов для ключа таблицы (`sku_catalog` в сторе — `skuCatalog`) */
function storeField(key: string): string {
  return key === 'sku_catalog' ? 'skuCatalog' : key;
}

function storeValue(key: string): unknown {
  return (useStore.getState() as unknown as Record<string, unknown>)[storeField(key)];
}

/** Записанный справочник — в стор: заказы сразу считают по нему */
function applyToStore(key: string, value: unknown): void {
  if (key === PRICES_KEY) {
    useStore.setState({ prices: mergePrices(value as Record<string, unknown>) } as never);
    invalidatePricesCache();
    return;
  }
  useStore.setState({ [storeField(key)]: value } as never);
}

/** Прайс: только изменённые верхние ключи и прежние значения ТЕХ ЖЕ ключей */
function savePrices(value: unknown, base: unknown): Promise<CatalogWriteResult> {
  const next = isObj(value) ? value : {};
  const prev = isObj(base) ? base : {};
  const patch: Record<string, unknown> = {};
  const baseOut: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(next), ...Object.keys(prev)])) {
    if (sameJson(next[k], prev[k])) continue;
    patch[k] = next[k] === undefined ? null : next[k];
    baseOut[k] = prev[k];
  }
  return patchPrices(patch, baseOut);
}

interface Loaded {
  value: unknown;
  base: unknown;
  state: CatalogEditorState;
  errorText?: string | null;
}

const LOADING: Loaded = { value: null, base: null, state: 'loading' };

export function useCatalogEditor<V = unknown, T extends CatalogTable = CatalogTable>(
  table: T,
  key: EditorKey<T>,
): CatalogEditor<V> {
  const [data, setData] = useState<Loaded>(LOADING);
  // Повтор загрузки — сменой ключа: состояние ставится только в ответе запроса
  const [attempt, setAttempt] = useState(0);
  const id = useId();

  useEffect(() => {
    let alive = true;
    void fetchCatalogKey(table, key).then((res) => {
      if (!alive) return;
      if (res && res.exists) {
        setData({ value: res.value, base: res.value, state: 'ready' });
        return;
      }
      // Сбой или строки нет — значение стора (сиды кода); база = оно же, правок нет
      const fallback = storeValue(key);
      setData({ value: fallback, base: fallback, state: 'fallback' });
    });
    return () => { alive = false; };
  }, [table, key, attempt]);

  const dirty = useMemo(
    () => data.state !== 'loading' && !sameJson(data.value, data.base),
    [data],
  );

  useEffect(() => {
    setCatalogUnsaved(id, dirty);
    return () => setCatalogUnsaved(id, false);
  }, [id, dirty]);

  const setValue = useCallback((next: Updater<V>) => {
    setData((d) => ({
      ...d,
      value: typeof next === 'function' ? (next as (p: V) => V)(d.value as V) : next,
    }));
  }, []);

  const reload = useCallback(() => {
    setData(LOADING);
    setAttempt((n) => n + 1);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    // Сохранять можно только поверх прочитанной из базы версии
    if (data.state !== 'ready' && data.state !== 'error') return false;
    if (!dirty) return true;
    const { value, base } = data;
    setData((d) => ({ ...d, state: 'saving' }));
    const res = key === PRICES_KEY
      ? await savePrices(value, base)
      : await putCatalog(table, key as CatalogKey<T>, value, base);
    if (res.ok) {
      applyToStore(key, value);
      // База — записанное; правки, сделанные во время записи, остаются правками
      setData((d) => ({ ...d, base: value, state: 'ready', errorText: null }));
      return true;
    }
    if (res.kind === 'conflict') {
      clearCatalogsCache();
      setData((d) => ({ ...d, state: 'conflict' }));
      return false;
    }
    // `invalid` (форма записи) показывается так же, как прежний `other`: текст сервера
    setData((d) => ({ ...d, state: 'error', errorText: res.message }));
    return false;
  }, [data, dirty, key, table]);

  return { value: data.value as V, setValue, dirty, save, reload, state: data.state, errorText: data.errorText ?? null };
}
