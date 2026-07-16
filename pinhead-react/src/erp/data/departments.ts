/**
 * Справочник цехов / участков (seed для MVP).
 *
 * Поток нелинейный: заказ может проходить любой набор этапов, партия дробится
 * и идёт параллельно (шелкография / ДТФ / вышивка — параллельные ветки брендирования).
 * `order` задаёт лишь ориентировочный порядок в потоке для сортировки в UI.
 */

export type DepartmentType =
  | 'supply'        // Закупка
  | 'logistics'     // Логистика
  | 'experimental'  // Экспериментальный
  | 'warehouse'     // Склад сырья
  | 'cutting'       // Раскрой
  | 'silkscreen'    // Шелкография
  | 'dtf'           // ДТФ
  | 'embroidery'    // Вышивка
  | 'sewing'        // Пошив
  | 'vto'           // ВТО
  | 'warehouse_fg'; // Склад готовой продукции

export interface Department {
  /** Стабильный машинный код */
  code: string;
  /** Название для UI */
  name: string;
  type: DepartmentType;
  /** Ориентировочный порядок в производственном потоке */
  order: number;
  /** Этап брендирования (параллельные ветки) */
  branding?: boolean;
}

export const DEPARTMENTS: Department[] = [
  { code: 'supply',       name: 'Закупка',                 type: 'supply',       order: 10 },
  { code: 'logistics',    name: 'Логистика',               type: 'logistics',    order: 20 },
  { code: 'experimental', name: 'Экспериментальный цех',   type: 'experimental', order: 30 },
  { code: 'warehouse',    name: 'Склад',                   type: 'warehouse',    order: 40 },
  { code: 'cutting',      name: 'Закройный цех',           type: 'cutting',      order: 50 },
  { code: 'silkscreen',   name: 'Цех шелкографии',         type: 'silkscreen',   order: 60, branding: true },
  { code: 'dtf',          name: 'Цех ДТФ',                 type: 'dtf',          order: 61, branding: true },
  { code: 'embroidery',   name: 'Цех вышивки',             type: 'embroidery',   order: 62, branding: true },
  { code: 'sewing',       name: 'Швейный цех',             type: 'sewing',       order: 70 },
  { code: 'vto',          name: 'ВТО цех',                 type: 'vto',          order: 80 },
  { code: 'warehouse_fg', name: 'Склад готовой продукции', type: 'warehouse_fg', order: 90 },
];

export function getDepartmentByCode(code: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.code === code);
}

/** Короткие имена для чипов/вкладок (единый словарь UI) */
export const DEPT_SHORT_NAMES: Record<string, string> = {
  supply: 'Закупка',
  logistics: 'Логистика',
  experimental: 'Эксперим.',
  warehouse: 'Склад',
  cutting: 'Закрой',
  silkscreen: 'Шелкография',
  dtf: 'ДТФ',
  embroidery: 'Вышивка',
  sewing: 'Швейка',
  vto: 'ВТО',
  warehouse_fg: 'Склад ГП',
};

export function deptShortName(code: string, fallback?: string): string {
  return DEPT_SHORT_NAMES[code] || fallback || code;
}
