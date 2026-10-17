/**
 * Показ справочника флэтов на вкладке «Флэты и зоны» (веха 5а, задача 4):
 * подписи типов и видов, строки списка, текст прогресса сида. Чистые функции —
 * вкладка только рисует.
 */
import type { FlatViewKind, GarmentFlat, GarmentType } from '../../design/types';
import { pluralize } from '../../../utils/i18n';

/**
 * Флэты пишут только admin и director — так же, как сервер: ключ `garmentFlats`
 * в `catalog_put` (`v_admin_pair`) и запись в бакет (`catalog_writer()`)
 */
export const FLAT_WRITER_ROLES = ['admin', 'director'];

export const GARMENT_TYPE_LABELS: Record<GarmentType, string> = {
  tshirt: 'Футболка',
  polo: 'Поло',
  longsleeve: 'Лонгслив',
  sweatshirt: 'Свитшот',
  hoodie: 'Худи',
  zip_hoodie: 'Зип-худи',
  half_zip: 'Халф-зип',
  bomber: 'Бомбер',
  olympic: 'Олимпийка',
  pants: 'Штаны',
  shopper: 'Шоппер',
};

export const VIEW_LABELS: Record<FlatViewKind, string> = {
  front: 'Перед',
  back: 'Спина',
  sleeve_left: 'Левый рукав',
  sleeve_right: 'Правый рукав',
};

export interface FlatRow {
  id: string;
  name: string;
  type: string;
  /** «Типовой» или «Лекало модели»; точные модели — в `models` */
  kind: string;
  models: string;
  active: boolean;
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

/** Строка состояния сида для `aria-live` */
export function seedStatusText(p: SeedProgressLike | null, busy: boolean): string {
  if (!busy) return '';
  if (!p) return 'Готовлю загрузку типовых флэтов…';
  if (p.phase === 'catalog') return 'Файлы загружены, сохраняю справочник флэтов…';
  return `Загружаю файлы флэтов: ${p.done} из ${p.total}`;
}
