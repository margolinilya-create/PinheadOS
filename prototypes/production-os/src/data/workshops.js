export const WORKSHOPS = [
  { code: 'cutting',      name: 'Раскрой',       color: '#8B5CF6', icon: '✂️' },
  { code: 'screen',       name: 'Шелкография',   color: '#EF4444', icon: '🖨️' },
  { code: 'dtf',          name: 'DTF',           color: '#F97316', icon: '🔥' },
  { code: 'embroidery',   name: 'Вышивка',       color: '#EC4899', icon: '🧵' },
  { code: 'sewing',       name: 'Пошив',         color: '#3B82F6', icon: '🪡' },
  { code: 'packaging_qc', name: 'Упаковка + ОТК', color: '#06A77D', icon: '📦' },
];

export const WORKSHOP_MAP = Object.fromEntries(WORKSHOPS.map(w => [w.code, w]));

// Маршруты по технике печати
export const ROUTE_TEMPLATES = {
  panel_print:   ['cutting', 'screen', 'sewing', 'packaging_qc'],
  dtf_print:     ['cutting', 'dtf', 'sewing', 'packaging_qc'],
  garment_print: ['cutting', 'sewing', 'embroidery', 'packaging_qc'],
  no_print:      ['cutting', 'sewing', 'packaging_qc'],
  screen_emb:    ['cutting', 'screen', 'sewing', 'embroidery', 'packaging_qc'],
};

export const QC_ITEMS = [
  { id: 'print_quality',   label: 'Качество печати',      description: 'Цвета, чёткость, позиционирование' },
  { id: 'sizes_correct',   label: 'Размеры верны',        description: 'Соответствие размерной сетке заказа' },
  { id: 'labels_attached', label: 'Бирки пришиты',        description: 'Основная, уходовая, хэнг-тэг' },
  { id: 'no_defects',      label: 'Без дефектов',         description: 'Нет пятен, дырок, кривых швов' },
  { id: 'packaging_ok',    label: 'Упаковка',             description: 'Сложено, в пакете, по размерам' },
  { id: 'qty_match',       label: 'Количество совпадает', description: 'Факт = план по каждому размеру' },
];
export const QC_ITEM_IDS = QC_ITEMS.map(i => i.id);

export const PROBLEM_TYPES = [
  { code: 'material',  label: 'Нет материала' },
  { code: 'defect',    label: 'Брак ткани / изделия' },
  { code: 'design',    label: 'Макет не подходит' },
  { code: 'equipment', label: 'Сбой оборудования' },
  { code: 'sizes',     label: 'Вопрос по размерам' },
  { code: 'other',     label: 'Другое' },
];
