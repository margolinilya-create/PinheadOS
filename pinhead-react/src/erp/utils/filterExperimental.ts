import type { ErpExperimental, ErpExperimentalTask } from '../types';
import { DEV_STATE_LABELS, devState } from './experimentalTasks';
import type { DevState } from './experimentalTasks';

/**
 * Фильтры и сортировка разработок (ТЗ заказчика 12.08, п.11).
 *
 * Отдельный модуль, а не расширение `filterStages`: там сущность —
 * `QueueEntry` (этап позиции в очереди цеха), и общий тип потребовал бы полей
 * -заглушек в обе стороны. Форма скопирована намеренно — тот же круг
 * «фильтры ↔ адрес», та же кнопка «Сбросить», то же поведение при возврате
 * из карточки.
 */

export type DevSort = 'due' | 'readiness' | 'created';

export const DEV_SORT_LABELS: Record<DevSort, string> = {
  due: 'По ближайшему сроку',
  readiness: 'По готовности',
  created: 'По дате создания',
};

export interface DevFilters {
  /** Поиск: название изделия, № заказа, № сделки */
  q: string;
  /** Вычисляемое состояние; '' — любое */
  state: DevState | '';
  /** Конструктор, проработчик, ответственный — по точному имени */
  constructorName: string;
  developer: string;
  owner: string;
  /** Тип разработки (справочник) */
  devType: string;
  /** Срок разработки от / до */
  dueFrom: string;
  dueTo: string;
  /** Только с проблемой: заблокированная задача */
  problem: boolean;
  sort: DevSort;
}

export const EMPTY_DEV_FILTERS: DevFilters = {
  q: '', state: '', constructorName: '', developer: '', owner: '',
  devType: '', dueFrom: '', dueTo: '', problem: false, sort: 'due',
};

/** Разработка вместе с её задачами — то, с чем работают фильтры и экран */
export interface DevRow {
  dev: ErpExperimental;
  tasks: ErpExperimentalTask[];
  state: DevState;
}

export { DEV_STATE_LABELS };

/** Собирает строки экрана: состояние считается ОДИН раз, а не в каждом фильтре */
export function buildDevRows(
  devs: readonly ErpExperimental[],
  today: string,
): DevRow[] {
  return (devs ?? []).map((dev) => {
    const tasks = dev.tasks ?? [];
    return { dev, tasks, state: devState(dev, tasks, today) };
  });
}

function matchesQuery(row: DevRow, q: string): boolean {
  const text = [
    row.dev.tech_name, row.dev.order?.title, row.dev.order?.bitrix_id,
    row.dev.dev_type,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes(q);
}

export function filterDevs(rows: readonly DevRow[], filters: DevFilters): DevRow[] {
  const f = { ...EMPTY_DEV_FILTERS, ...filters };
  const q = f.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (q && !matchesQuery(row, q)) return false;
    if (f.state && row.state !== f.state) return false;
    if (f.constructorName && row.dev.constructor !== f.constructorName) return false;
    if (f.developer && row.dev.technologist !== f.developer) return false;
    if (f.owner && row.dev.owner !== f.owner) return false;
    if (f.devType && row.dev.dev_type !== f.devType) return false;
    // Срок разработки: свой, иначе унаследованный от заказа
    const due = row.dev.due_date || row.dev.order?.due_date || '';
    if (f.dueFrom && (!due || due < f.dueFrom)) return false;
    if (f.dueTo && (!due || due > f.dueTo)) return false;
    if (f.problem && !row.tasks.some((t) => t.status === 'blocked')) return false;
    return true;
  });
}

/** Сортировка; исходный массив не мутируется */
export function sortDevs(rows: readonly DevRow[], sort: DevSort = 'due'): DevRow[] {
  const list = [...rows];
  const dueOf = (r: DevRow) => r.dev.due_date || r.dev.order?.due_date || '9999-12-31';
  if (sort === 'created') {
    return list.sort((a, b) => (b.dev.created_at || '').localeCompare(a.dev.created_at || ''));
  }
  if (sort === 'readiness') {
    // Наименее готовые сверху: им нужно внимание. Разработка без задач идёт
    // первой — она вообще не начата
    const pctOf = (r: DevRow) => {
      const relevant = r.tasks.filter((t) => t.status !== 'cancelled');
      if (relevant.length === 0) return -1;
      return relevant.filter((t) => t.status === 'done').length / relevant.length;
    };
    return list.sort((a, b) => pctOf(a) - pctOf(b) || dueOf(a).localeCompare(dueOf(b)));
  }
  return list.sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
}

export function applyDevFilters(rows: readonly DevRow[], filters: DevFilters): DevRow[] {
  return sortDevs(filterDevs(rows, filters), filters.sort);
}

export function hasActiveDevFilters(filters: DevFilters): boolean {
  return (
    Boolean(filters.q || filters.state || filters.constructorName || filters.developer
      || filters.owner || filters.devType || filters.dueFrom || filters.dueTo)
    || filters.problem
    || filters.sort !== EMPTY_DEV_FILTERS.sort
  );
}

// --- Синхронизация с адресом ------------------------------------------------

const TEXTS = ['q', 'constructorName', 'developer', 'owner', 'devType',
  'dueFrom', 'dueTo'] as const;

const STATE_VALUES: DevState[] = ['new', 'in_progress', 'attention', 'fitting', 'ready'];
const SORT_VALUES: DevSort[] = ['due', 'readiness', 'created'];

export function devFiltersFromParams(params: URLSearchParams): DevFilters {
  const out = { ...EMPTY_DEV_FILTERS };
  for (const key of TEXTS) {
    const v = params.get(key);
    if (v) out[key] = v;
  }
  out.problem = params.get('problem') === '1';
  // Белые списки: мусор в адресе не должен давать молча пустой экран
  const state = params.get('state');
  if (state && STATE_VALUES.includes(state as DevState)) out.state = state as DevState;
  const sort = params.get('sort');
  if (sort && SORT_VALUES.includes(sort as DevSort)) out.sort = sort as DevSort;
  return out;
}

/**
 * Все ключи адреса, которыми владеют фильтры.
 *
 * Нужен тому, кто пишет фильтры В СУЩЕСТВУЮЩИЙ адрес: снять свои ключи
 * и поставить новые, не трогая чужие (`view`, `studio`, `page`). Полная
 * замена набора однажды уже сбрасывала выбранный вид на доску при каждом
 * клике по фильтру.
 */
export function devFilterParamKeys(): string[] {
  return [...TEXTS, 'problem', 'state', 'sort'];
}

export function devFiltersToParams(filters: DevFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TEXTS) {
    const v = filters[key];
    if (v) out[key] = v;
  }
  if (filters.problem) out.problem = '1';
  if (filters.state) out.state = filters.state;
  if (filters.sort !== EMPTY_DEV_FILTERS.sort) out.sort = filters.sort;
  return out;
}
