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
  | 'dtg'           // DTG — прямая печать по изделию
  | 'embroidery'    // Вышивка
  | 'sewing'        // Пошив
  | 'vto'           // ВТО
  | 'qc'            // ОТК (финальный контроль)
  | 'warehouse_fg'  // Склад готовой продукции
  | 'outsource';    // Подряд — шаг маршрута, выполняемый снаружи

export interface Department {
  /** Стабильный машинный код */
  code: string;
  /** Название для UI */
  name: string;
  type: DepartmentType;
  /** Ориентировочный порядок в производственном потоке */
  order: number;
  /** Этап брендирования (параллельные ветки); имя — как колонка erp_departments.is_branding */
  is_branding?: boolean;
}

export const DEPARTMENTS: Department[] = [
  { code: 'supply',       name: 'Закупка',                 type: 'supply',       order: 10 },
  { code: 'logistics',    name: 'Логистика',               type: 'logistics',    order: 20 },
  { code: 'experimental', name: 'Экспериментальный цех',   type: 'experimental', order: 30 },
  { code: 'warehouse',    name: 'Склад',                   type: 'warehouse',    order: 40 },
  { code: 'cutting',      name: 'Закройный цех',           type: 'cutting',      order: 50 },
  { code: 'silkscreen',   name: 'Цех шелкографии',         type: 'silkscreen',   order: 60, is_branding: true },
  { code: 'dtf',          name: 'Цех ДТФ',                 type: 'dtf',          order: 61, is_branding: true },
  { code: 'embroidery',   name: 'Цех вышивки',             type: 'embroidery',   order: 62, is_branding: true },
  // DTG заведён правками 20.08: документ называет его и среди этапов маршрута,
  // и среди представлений экс-цеха, а участка в ERP не было вовсе
  { code: 'dtg',          name: 'Цех DTG',                 type: 'dtg',          order: 63, is_branding: true },
  { code: 'sewing',       name: 'Швейный цех',             type: 'sewing',       order: 70 },
  { code: 'vto',          name: 'ВТО цех',                 type: 'vto',          order: 80 },
  { code: 'qc',           name: 'ОТК',                     type: 'qc',           order: 85 },
  { code: 'warehouse_fg', name: 'Склад готовой продукции', type: 'warehouse_fg', order: 90 },
  /**
   * «Подряд» заведён правками 21.08: документ просит отдельный участок в списке
   * участков, при выборе которого исполнитель определяется сам. Это НЕ наш цех
   * и не подрядчик как компания — это место в маршруте, где работу делают
   * снаружи; имя подрядчика и операция живут в самом этапе.
   *
   * Непроизводственный намеренно: задача подряда видна только во вкладке
   * «Подряд» — в очередь, канбан, план и загрузку она не попадает.
   */
  { code: 'outsource',    name: 'Подряд',                  type: 'outsource',    order: 95 },
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
  dtg: 'DTG',
  sewing: 'Швейка',
  vto: 'ВТО',
  qc: 'ОТК',
  warehouse_fg: 'Склад ГП',
  outsource: 'Подряд',
};

export function deptShortName(code: string, fallback?: string): string {
  return DEPT_SHORT_NAMES[code] || fallback || code;
}

/** Иконки участков для постоянного меню цехов в сайдбаре (правка 1) */
/**
 * Имена иконок участков из набора `erp/components/icons.js` (не эмодзи:
 * те по-разному рисуются в Windows/Android и не наследуют цвет активного пункта).
 */
export const DEPT_ICONS: Record<string, string> = {
  supply: 'truck',
  logistics: 'route',
  experimental: 'flask',
  warehouse: 'box',
  cutting: 'scissors',
  silkscreen: 'printer',
  dtf: 'printer',
  embroidery: 'needle',
  dtg: 'printer',
  sewing: 'needle',
  vto: 'iron',
  qc: 'shield',
  warehouse_fg: 'tag',
  // Работа уходит наружу — та же метафора, что у ссылки на внешний ресурс
  outsource: 'externalLink',
};

/** Имя иконки участка; неизвестный код — нейтральная «очередь» */
export function deptIcon(code: string): string {
  return DEPT_ICONS[code] || 'queue';
}

/**
 * Цеха с рабочей очередью («Мой цех», загрузка на дашборде).
 * Закупка управляется своим экраном (материалы), логистика и склады
 * пока без операций — в очередях не показываем.
 *
 * ВАЖНО: это только сид. Рабочий признак живёт в `erp_departments.is_production`
 * и правится в админке — иначе участок, заведённый директором, не появился бы
 * ни в меню, ни в канбане, ни в маршруте, ни в требованиях ТЗ.
 */
// experimental вынесен в отдельную вкладку «Эксперим. цех» (правка 6) — не в общей очереди
export const QUEUE_DEPT_CODES = new Set([
  'cutting', 'silkscreen', 'dtf', 'embroidery', 'dtg', 'sewing', 'vto', 'qc',
]);

/** @deprecated Признак по коду — только для сида. В коде: `isProductionDept(dept)` */
export function isQueueDept(code: string): boolean {
  return QUEUE_DEPT_CODES.has(code);
}

/** Минимум строки цеха для проверки признака */
export interface ProductionDeptLike {
  code?: string | null;
  is_production?: boolean | null;
}

/**
 * Производственный ли участок: есть рабочая очередь, показывается в канбане,
 * требует ТЗ. Источник — колонка `is_production`; на код откатываемся только
 * если строка пришла без неё (старый кэш, урезанный select, тестовая фикстура).
 */
export function isProductionDept(dept: ProductionDeptLike | null | undefined): boolean {
  if (!dept) return false;
  if (typeof dept.is_production === 'boolean') return dept.is_production;
  return Boolean(dept.code) && QUEUE_DEPT_CODES.has(dept.code as string);
}
