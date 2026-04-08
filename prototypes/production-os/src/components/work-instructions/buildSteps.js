import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data/labels';

const COLOR_NAMES = {
  white: 'Белый',
  black: 'Чёрный',
  navy: 'Тёмно-синий',
  grey: 'Серый',
  red: 'Красный',
  yellow: 'Жёлтый',
};

export default function buildSteps(task, order) {
  const item = order?.data?.items?.[0];
  const ws = task?.workshop_code;

  if (!item || !ws) return [];

  const typeName = TYPE_NAMES[item.type] || item.type || '—';
  const fabricName = FABRIC_NAMES[item.fabric] || item.fabric || '—';
  const colorName = COLOR_NAMES[item.color] || item.color || '—';
  const fitName = item.fit === 'oversize' ? 'Оверсайз' : item.fit === 'regular' ? 'Регуляр' : item.fit || '—';
  const orderNotes = order?.data?.notes || null;
  const handoffNote = task?.handoff_note || null;

  if (ws === 'screen' || ws === 'dtf') {
    const zones = item.zones || [];
    const techName = TECH_NAMES[ws] || ws;
    return [
      {
        title: 'Подготовка',
        content: { type: 'prep', typeName, fabricName, colorName, qty: task.total_units },
      },
      {
        title: 'Зоны печати',
        content: { type: 'zones', zones, zoneTechs: item.zoneTechs, techName },
      },
      {
        title: 'Размерная сетка',
        content: { type: 'sizes', sizes: item.sizes },
      },
      {
        title: 'Примечания',
        content: { type: 'notes', handoffNote, orderNotes },
      },
    ];
  }

  if (ws === 'sewing') {
    return [
      {
        title: 'Крой',
        content: { type: 'sewing_prep', fabricName, fitName, colorName },
      },
      {
        title: 'Размерная сетка',
        content: { type: 'sizes', sizes: item.sizes },
      },
      {
        title: 'Этикетки',
        content: { type: 'labels', hasLabels: !!(order?.data?.labels), labelInfo: order?.data?.labels || null },
      },
      {
        title: 'Примечания',
        content: { type: 'notes', handoffNote, orderNotes },
      },
    ];
  }

  if (ws === 'cutting') {
    return [
      {
        title: 'Материал',
        content: { type: 'material', fabricName, colorName },
      },
      {
        title: 'Размеры',
        content: { type: 'sizes', sizes: item.sizes },
      },
      {
        title: 'Примечания',
        content: { type: 'notes', handoffNote, orderNotes },
      },
    ];
  }

  if (ws === 'packaging_qc') {
    return [
      {
        title: 'Заказ',
        content: { type: 'order_info', clientName: order?.data?.name, orderNumber: order?.order_number, qty: task.total_units },
      },
      {
        title: 'Проверка',
        content: {
          type: 'qc_checklist',
          items: [
            'Качество печати соответствует макету',
            'Размеры совпадают с размерной сеткой',
            'Этикетки пришиты / наклеены',
            'Нет видимых дефектов',
            'Упаковка по стандарту',
            'Количество совпадает с заказом',
          ],
        },
      },
      {
        title: 'Упаковка',
        content: { type: 'packaging', typeName, qty: task.total_units, colorName },
      },
      {
        title: 'Примечания',
        content: { type: 'notes', handoffNote, orderNotes },
      },
    ];
  }

  if (ws === 'embroidery') {
    const embZones = (item.zones || []).filter(z => item.zoneTechs?.[z] === 'embroidery');
    return [
      {
        title: 'Вышивка',
        content: { type: 'embroidery_prep', zones: embZones, fabricName, colorName },
      },
      {
        title: 'Размерная сетка',
        content: { type: 'sizes', sizes: item.sizes },
      },
      {
        title: 'Примечания',
        content: { type: 'notes', handoffNote, orderNotes },
      },
    ];
  }

  return [
    {
      title: 'Задание',
      content: { type: 'prep', typeName, fabricName, colorName, qty: task.total_units },
    },
    {
      title: 'Размерная сетка',
      content: { type: 'sizes', sizes: item.sizes },
    },
    {
      title: 'Примечания',
      content: { type: 'notes', handoffNote, orderNotes },
    },
  ];
}
