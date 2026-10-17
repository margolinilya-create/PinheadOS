/**
 * Сид типовых флэтов кнопкой «Загрузить типовые флэты» (веха 5а, решение
 * контроллера 1; задача 4). Модуль грузится ТОЛЬКО `import()` по кнопке
 * вкладки «Флэты и зоны»: 67 SVG и справочник лежат одним ленивым чанком
 * (`eager` внутри модуля — не 67 чанков, вытесняющих кэш service worker).
 * Что сид не попал во вход и оболочки, сторожит `scripts/bundle-budget.mjs`.
 *
 * Порядок (справочник никогда не ссылается на файл, которого нет):
 *   1. свежее значение `app_config.garmentFlats` (`fetchCatalogKey`) — оно же
 *      база записи; строки нет — база `null`;
 *   2. по каждому флэту сида, которого нет в справочнике (по `id`), — каждый
 *      вид: `sanitizeSvg` и загрузка в бакет `upsert: false` («уже есть» —
 *      успех: путь версионный, содержимое то же);
 *   3. последним — `putCatalog` справочника: прежние флэты как есть
 *      (не перезаписываются), недостающие — в конец.
 *
 * Повтор после частичного сбоя идемпотентен. Хоть один файл не загрузился —
 * справочник не пишется, тост называет число файлов; после первого отказа
 * новые загрузки не начинаются (связь легла — не 67 тостов, а до четырёх).
 *
 * Сид один на вкладку браузера: ушли с вкладки «Флэты и зоны» во время
 * загрузки, вернулись и нажали кнопку снова — вызов присоединяется к летящему
 * сиду (тот же результат с `joined: true`, прогресс — и новому слушателю),
 * а не начинает второй: без лишних запросов и ложного конфликта записи.
 */
import seed from './garmentFlats.seed.json';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { putCatalog } from '../../api/catalogAdmin';
import { uploadFlatSvg } from '../../api/garmentFlats';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { toast } from '../../../store/useToastStore';
import { pluralize } from '../../../utils/i18n';
import type { GarmentFlat, GarmentFlatsCatalog } from '../types';

const FILES = import.meta.glob('./flats/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const SEED = seed as unknown as GarmentFlatsCatalog;

/** Сколько файлов грузится одновременно */
export const SEED_CONCURRENCY = 4;

export type SeedCatalogOutcome = 'saved' | 'conflict' | 'unchanged' | 'error';

export interface SeedResult {
  /** Загружено файлов */
  uploaded: number;
  /** Уже были в бакете (повтор после сбоя) */
  existed: number;
  /** Не загружено — отказ или не начатые после отказа */
  failed: number;
  /** Флэтов дописано в справочник (недостающих типовых) */
  added: number;
  catalog: SeedCatalogOutcome;
  /** Вызов присоединился к уже летящему сиду: итог (тост) называет первый вызов */
  joined?: true;
}

export interface SeedProgress {
  done: number;
  total: number;
  /** `files` — загрузка SVG, `catalog` — запись справочника */
  phase: 'files' | 'catalog';
}

export interface SeedOptions {
  onProgress?: (p: SeedProgress) => void;
}

interface Job {
  path: string;
  file: string;
}

type Outcome = 'uploaded' | 'exists' | null;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Флэты справочника из базы; неверная форма — `null` (дописывать некуда) */
function storedFlats(value: unknown): unknown[] | null {
  if (!isObj(value) || value.version !== 1 || !Array.isArray(value.flats)) return null;
  return value.flats;
}

function idOf(f: unknown): string | null {
  return isObj(f) && typeof f.id === 'string' ? f.id : null;
}

const result = (patch: Partial<SeedResult> & Pick<SeedResult, 'catalog'>): SeedResult =>
  ({ uploaded: 0, existed: 0, failed: 0, added: 0, ...patch });

function jobsOf(flats: GarmentFlat[]): Job[] {
  return flats.flatMap((f) => f.views.map((v) => ({ path: v.svg_path, file: `./flats/${f.id}-${v.kind}.svg` })));
}

/** Один файл: очистка и загрузка. Отказ — `null` (тост загрузки уже показан) */
async function uploadOne(job: Job): Promise<Outcome> {
  const text = FILES[job.file];
  if (typeof text !== 'string') {
    console.error('seedFlats: нет файла сида', job.file);
    return null;
  }
  const clean = sanitizeSvg(text);
  if (!clean.ok) {
    console.error('seedFlats: файл сида не прошёл санитайзер', job.file, clean.error);
    return null;
  }
  try {
    return await uploadFlatSvg(job.path, clean.svg);
  } catch (e) {
    console.error('seedFlats', job.path, e);
    return null;
  }
}

/** Загрузка пачкой по `SEED_CONCURRENCY`; после первого отказа новых не начинает */
async function uploadAll(jobs: Job[], onDone: (n: number) => void): Promise<Outcome[]> {
  const out: Outcome[] = jobs.map(() => null);
  let next = 0;
  let done = 0;
  let stopped = false;
  const lane = async () => {
    while (!stopped && next < jobs.length) {
      const i = next;
      next += 1;
      out[i] = await uploadOne(jobs[i]);
      if (out[i] === null) stopped = true;
      done += 1;
      onDone(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEED_CONCURRENCY, jobs.length) }, lane));
  return out;
}

function failedText(failed: number, total: number): string {
  return `Типовые флэты не сохранены: не загружено ${failed} ${pluralize(failed, 'файл', 'файла', 'файлов')} из ${total}. `
    + 'Справочник не изменён — нажмите «Загрузить типовые флэты» ещё раз';
}

type ProgressListener = (p: SeedProgress) => void;

interface Run {
  promise: Promise<SeedResult>;
  listeners: Set<ProgressListener>;
  last: SeedProgress | null;
}

/** Летящий сид модуля (не больше одного на вкладку браузера) */
let inflight: Run | null = null;

/**
 * Дописать недостающие типовые флэты: файлы, затем справочник (порядок — в шапке
 * модуля). Пока сид летит, повторный вызов присоединяется к нему.
 */
export function seedFlats({ onProgress }: SeedOptions = {}): Promise<SeedResult> {
  if (inflight) {
    if (onProgress) {
      inflight.listeners.add(onProgress);
      if (inflight.last) onProgress(inflight.last);
    }
    return inflight.promise.then((r): SeedResult => ({ ...r, joined: true }));
  }
  const run: Omit<Run, 'promise'> = { listeners: new Set(onProgress ? [onProgress] : []), last: null };
  const report = (p: SeedProgress) => {
    run.last = p;
    run.listeners.forEach((fn) => fn(p));
  };
  // `finally` срабатывает не раньше микрозадачи — `inflight` к тому времени уже назначен
  const promise = seedOnce(report).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = Object.assign(run, { promise });
  return promise;
}

async function seedOnce(onProgress: ProgressListener): Promise<SeedResult> {
  const fresh = await fetchCatalogKey('app_config', 'garmentFlats');
  if (!fresh) return result({ catalog: 'error' });
  const base = fresh.exists ? fresh.value : null;
  const stored = fresh.exists ? storedFlats(base) : [];
  if (!stored) {
    toast.error('Типовые флэты не загружены: справочник флэтов в базе неверной формы (нужны version = 1 и список flats)');
    return result({ catalog: 'error' });
  }

  const have = new Set(stored.map(idOf).filter((id): id is string => id !== null));
  const missing = SEED.flats.filter((f) => !have.has(f.id));
  if (missing.length === 0) return result({ catalog: 'unchanged' });

  const jobs = jobsOf(missing);
  const total = jobs.length;
  onProgress({ done: 0, total, phase: 'files' });
  const outcomes = await uploadAll(jobs, (done) => onProgress({ done, total, phase: 'files' }));
  const uploaded = outcomes.filter((o) => o === 'uploaded').length;
  const existed = outcomes.filter((o) => o === 'exists').length;
  const failed = total - uploaded - existed;
  if (failed > 0) {
    toast.error(failedText(failed, total));
    return result({ uploaded, existed, failed, catalog: 'error' });
  }

  onProgress({ done: total, total, phase: 'catalog' });
  const merged = { ...(isObj(base) ? base : {}), version: 1, flats: [...stored, ...missing] };
  const res = await putCatalog('app_config', 'garmentFlats', merged, base);
  const catalog: SeedCatalogOutcome = res.ok ? 'saved' : res.kind === 'conflict' ? 'conflict' : 'error';
  return result({ uploaded, existed, failed: 0, added: res.ok ? missing.length : 0, catalog });
}
