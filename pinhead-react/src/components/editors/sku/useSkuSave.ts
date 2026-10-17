/**
 * Запись каталога `/sku` без затирания (веха 4, задача 5).
 *
 * Было: «Сохранить» слал `upsert` всех восьми справочников целиком — и прайс
 * целиком, с умолчаниями кода, — поверх того, что успели записать другая
 * вкладка, другой администратор или ERP. При отказе сети флаги правок всё
 * равно сбрасывались, а тост говорил «Сохранено локально».
 *
 * Стало:
 *   · пишутся только ИЗМЕНЁННЫЕ справочники — `putCatalog` (`catalog_put`),
 *     курс — одним ключом прайса `patchPrices({ usdRate })`;
 *   · база записи — значение справочника, С КОТОРОГО начиналась правка
 *     (снимок стора при открытии; пока справочник не правили, снимок следует
 *     за стором — каталог мог прийти из базы уже после открытия). Сервер
 *     пишет, только если в базе всё ещё она, — иначе конфликт;
 *   · частичный отказ: записанные справочники приняты, у отказавших флаги
 *     и правки остаются, отказ показан по справочникам; на конфликт —
 *     «Загрузить свежую версию» (свежая версия заменяет правки ЭТОГО справочника).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { toast } from '../../../store/useToastStore';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { putCatalog, patchPrices } from '../../../orderstudio/api/catalogAdmin';
import type { CatalogWriteResult } from '../../../orderstudio/api/catalogAdmin';
import { sameJson } from '../../../orderstudio/admin/useCatalogEditor';
import { invalidatePricesCache } from '../../../utils/pricing';
import { storageSet } from '../../../lib/storage';

type Table = 'app_config' | 'catalog_config';

interface CatalogDef {
  /** Поле стора каталогов */
  field: string;
  table: Table;
  key: string;
  /** Имя справочника в тексте отказа — как вкладка редактора */
  name: string;
  /** Зеркало в localStorage — запасной путь `loadCatalogs` без сети */
  ls: string;
}

export const SKU_CATALOGS: CatalogDef[] = [
  { field: 'skuCatalog', table: 'app_config', key: 'sku_catalog', name: 'Изделия', ls: 'ph_sku' },
  { field: 'fabricsCatalog', table: 'catalog_config', key: 'fabricsCatalog', name: 'Основная ткань', ls: 'ph_fabrics' },
  { field: 'trimCatalog', table: 'catalog_config', key: 'trimCatalog', name: 'Отделочная ткань', ls: 'ph_trims' },
  { field: 'extrasCatalog', table: 'app_config', key: 'extrasCatalog', name: 'Обработки', ls: 'ph_extras' },
  { field: 'hardwareCatalog', table: 'app_config', key: 'hardwareCatalog', name: 'Фурнитура', ls: 'ph_hardware' },
  { field: 'categoryRules', table: 'app_config', key: 'categoryRules', name: 'Правила категорий', ls: 'ph_category_rules' },
  { field: 'zonesCatalog', table: 'app_config', key: 'zonesCatalog', name: 'Зоны нанесения', ls: 'ph_zones' },
];

/** Внутренний курс — ключ прайса `usdRate` */
const RATE = { field: 'usdRate', name: 'Внутренний курс' } as const;

const FIELDS = [...SKU_CATALOGS.map((c) => c.field), RATE.field];

export interface SkuSaveFailure {
  field: string;
  name: string;
  kind: 'conflict' | 'forbidden' | 'other';
}

type StoreRecord = Record<string, unknown>;
const storeState = (): StoreRecord => useStore.getState() as unknown as StoreRecord;

function snapshot(s: StoreRecord): StoreRecord {
  return Object.fromEntries(FIELDS.map((f) => [f, s[f]]));
}

interface Job {
  field: string;
  name: string;
  value: unknown;
  run: () => Promise<CatalogWriteResult>;
  def?: CatalogDef;
}

/** Текст отказа по справочникам: «Изделия — уже изменили…; Фурнитура — нет права» */
export function failureText(failed: SkuSaveFailure[]): string {
  const why = (k: SkuSaveFailure['kind']) => (k === 'conflict'
    ? 'уже изменили в другой вкладке, другой администратор или ERP'
    : k === 'forbidden' ? 'нет права' : 'не удалось записать');
  return failed.map((f) => `${f.name} — ${why(f.kind)}`).join('; ');
}

/**
 * `onSaved(fields)` — справочники, которые больше не отличаются от базы
 * (записаны или заменены свежей версией): редактор снимает их флаги правок.
 */
export function useSkuSave(onSaved: (fields: string[]) => void) {
  const basesRef = useRef<StoreRecord | null>(null);
  if (basesRef.current === null) basesRef.current = snapshot(storeState());
  const touchedRef = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<SkuSaveFailure[]>([]);

  // Пока справочник не правили, база следует за стором: каталог из базы
  // мог прийти уже после открытия редактора (прямой заход на /sku)
  useEffect(() => useStore.subscribe((s) => {
    const st = s as unknown as StoreRecord;
    const bases = basesRef.current as StoreRecord;
    for (const f of FIELDS) {
      if (!touchedRef.current.has(f)) bases[f] = st[f];
    }
  }), []);

  /** Правка справочника редактором: с этого момента его база заморожена */
  const edit = useCallback((field: string, value: unknown) => {
    touchedRef.current.add(field);
    (storeState().setField as (f: string, v: unknown) => void)(field, value);
  }, []);

  const accept = (field: string, value: unknown) => {
    (basesRef.current as StoreRecord)[field] = value;
    touchedRef.current.delete(field);
  };

  const saveAll = useCallback(async (): Promise<boolean> => {
    const state = storeState();
    const bases = basesRef.current as StoreRecord;
    const jobs: Job[] = [];
    for (const def of SKU_CATALOGS) {
      const value = state[def.field];
      if (sameJson(value, bases[def.field])) continue;
      const base = bases[def.field];
      jobs.push({ field: def.field, name: def.name, value, def, run: () => putCatalog(def.table, def.key as never, value, base) });
    }
    if (!sameJson(state.usdRate, bases.usdRate)) {
      const value = state.usdRate;
      const base = bases.usdRate;
      jobs.push({ field: RATE.field, name: RATE.name, value, run: () => patchPrices({ usdRate: value }, { usdRate: base }) });
    }
    if (jobs.length === 0) {
      setFailed([]);
      toast.success('Изменений нет — каталог совпадает с сохранённым');
      return true;
    }

    setSaving(true);
    const results = await Promise.all(jobs.map((j) => j.run()));
    const saved: string[] = [];
    const lost: SkuSaveFailure[] = [];
    jobs.forEach((j, i) => {
      const r = results[i];
      if (!r.ok) {
        lost.push({ field: j.field, name: j.name, kind: r.kind });
        return;
      }
      accept(j.field, j.value);
      saved.push(j.field);
      // Зеркало для запасного пути — только записанное в базу
      if (j.def) storageSet(j.def.ls, j.value);
      if (j.field === RATE.field) {
        useStore.setState({ prices: { ...(storeState().prices as StoreRecord), usdRate: j.value } } as never);
        invalidatePricesCache();
      }
    });
    if (saved.length) onSaved(saved);
    setFailed(lost);
    setSaving(false);
    if (lost.length === 0) toast.success('Каталог сохранён');
    return lost.length === 0;
  }, [onSaved]);

  /**
   * Свежая версия справочников с конфликтом: заменяет их правки на экране,
   * база — она же. Не загрузилось — справочник остаётся в списке отказов.
   */
  const reloadConflicts = useCallback(async () => {
    const conflicts = failed.filter((f) => f.kind === 'conflict');
    const replaced: string[] = [];
    const resolved: string[] = [];
    await Promise.all(conflicts.map(async (f) => {
      const def = SKU_CATALOGS.find((c) => c.field === f.field);
      const res = def
        ? await fetchCatalogKey(def.table, def.key)
        : await fetchCatalogKey('app_config', 'prices');
      if (!res) return;
      const value = def
        ? (res.exists ? res.value : null)
        : (res.value as StoreRecord | null)?.usdRate ?? null;
      if (value === null) {
        // Строки (или ключа курса) в базе нет: база — пусто, правки остаются
        (basesRef.current as StoreRecord)[f.field] = null;
      } else {
        accept(f.field, value);
        useStore.setState({ [f.field]: value } as never);
        if (f.field === RATE.field) {
          useStore.setState({ prices: { ...(storeState().prices as StoreRecord), usdRate: value } } as never);
          invalidatePricesCache();
        }
        replaced.push(f.field);
      }
      resolved.push(f.field);
    }));
    if (replaced.length) onSaved(replaced);
    if (resolved.length) setFailed((prev) => prev.filter((f) => !resolved.includes(f.field)));
  }, [failed, onSaved]);

  return { edit, saveAll, saving, failed, reloadConflicts };
}
