/**
 * Показ справочника флэтов на вкладке «Флэты и зоны» (веха 5а, задача 4):
 * подписи типов и видов, строки списка, текст прогресса сида. Чистые функции —
 * вкладка только рисует.
 */
import type { GarmentFlat } from '../../design/types';
import { GARMENT_TYPE_LABELS, VIEW_LABELS } from '../../design/catalog/flatLabels';
import { pluralize } from '../../../utils/i18n';

/**
 * Флэты пишут только admin и director — так же, как сервер: ключ `garmentFlats`
 * в `catalog_put` (`v_admin_pair`) и запись в бакет (`catalog_writer()`)
 */
export const FLAT_WRITER_ROLES = ['admin', 'director'];

/** Подписи типов и видов — в `design/catalog/flatLabels.ts` (веха 5б); здесь реэкспорт для прежних читателей */
export { GARMENT_TYPE_LABELS, VIEW_LABELS };

export interface FlatRow {
  id: string;
  name: string;
  type: string;
  /** «Типовой» или «Лекало модели»; точные модели — в `models` */
  kind: string;
  models: string;
  active: boolean;
  /** Текущая версия геометрии (веха 5б: колонка «Версия») */
  version: number;
  views: string;
  /** Печатных зон во всех видах */
  zoneCount: number;
  /** Названия зон без повторов, в порядке видов */
  zones: string[];
}

export function flatRow(f: GarmentFlat): FlatRow {
  const areas = f.views.flatMap((v) => v.print_areas.map((a) => a.name));
  const zones = [...new Set(areas)];
  return {
    id: f.id,
    name: f.name,
    type: GARMENT_TYPE_LABELS[f.garment_type] ?? f.garment_type,
    kind: f.typical ? 'Типовой' : 'Лекало модели',
    models: f.sku_codes.join(', '),
    active: f.active,
    version: f.version,
    views: f.views.map((v) => VIEW_LABELS[v.kind] ?? v.kind).join(', '),
    zoneCount: areas.length,
    zones,
  };
}

/** Число зон словами: «3 зоны» */
export function zonesCount(n: number): string {
  return `${n} ${pluralize(n, 'зона', 'зоны', 'зон')}`;
}

export interface SeedProgressLike {
  done: number;
  total: number;
  phase: 'files' | 'catalog';
}

/** Строка состояния сида: видимая (на каждый файл) и для `aria-live` (прорежённая) */
export function seedStatusText(p: SeedProgressLike | null, busy: boolean): string {
  if (!busy) return '';
  if (!p) return 'Готовлю загрузку типовых флэтов…';
  if (p.phase === 'catalog') return 'Файлы загружены, сохраняю справочник флэтов…';
  return `Загружаю файлы флэтов: ${p.done} из ${p.total}`;
}

/** На сколько шагов делится загрузка файлов для экранного диктора */
export const SEED_SPOKEN_STEPS = 4;

const spokenStep = (p: SeedProgressLike): number =>
  (p.total > 0 ? Math.floor((p.done * SEED_SPOKEN_STEPS) / p.total) : 0);

/**
 * Что объявить диктору: не каждый из 67 файлов, а смену фазы и каждую четверть
 * загрузки (`SEED_SPOKEN_STEPS`). Возвращает новый прогресс, если его стоит
 * объявить, иначе прежний — тот же объект, React не перерисует регион.
 * Видимый прогресс (`<progress>` и строка) идёт по каждому файлу.
 */
export function spokenProgress(prev: SeedProgressLike | null, next: SeedProgressLike): SeedProgressLike {
  if (!prev || prev.phase !== next.phase || spokenStep(prev) !== spokenStep(next)) return next;
  return prev;
}

/**
 * Конфликт записи справочника при сиде. Текст вехи 4 («Ваши правки не сохранены…
 * внесите их снова») здесь неточен: правок нет, файлы уже в бакете, повтор
 * идемпотентен — достаточно перечитать справочник и нажать кнопку ещё раз.
 */
export const SEED_CONFLICT_TEXT = 'Справочник «Флэты и зоны» уже изменили — в другой вкладке или другой администратор. '
  + 'Типовые флэты в него не дописаны. Загрузите свежую версию и нажмите «Загрузить типовые флэты» ещё раз.';
