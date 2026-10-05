import { orderQty } from '../../utils/shipment';
import { matchesOrderQuery } from '../../utils/orderSearch';
import { formatDateShort } from '../../utils/time';
import { addDays } from '../../../utils/date';
import {
  WAREHOUSE_TASK_TYPE_LABELS, MARKING_STATUS_LABELS, PACK_SHIP_STATUS_LABELS,
  FG_RECEIPT_STATUS_LABELS, SUBCONTRACT_RECEIPT_STATUS_LABELS,
  SUBCONTRACT_SEND_STATUS_LABELS, SHIPPED_STATUS_LABELS,
} from '../../types';
import { qtyLeftToAccept } from '../../utils/receiptLink';

/**
 * Правила экрана «Склад» — чистыми функциями, отдельно от разметки.
 *
 * Вынесены из `Warehouse.jsx` 05.10 (правка п. 8): экран стоял на потолке
 * ратчета размера, а правила (вкладки, подписи действий, срок, поиск)
 * читают и таблица, и карточка планшета, и панель задачи. Таблицы типов
 * (`TYPE_ICON`, `TERMINAL`, `TYPE_ORDER`) сторожит `warehouseTaskTypes.test.ts`
 * — он читает этот файл.
 */

export const TYPE_ICON = {
  material_receipt: 'inbox', subcontract_send: 'externalLink',
  subcontract_receipt: 'truck', marking: 'tag',
  fg_receipt: 'checkCircle', pack_ship: 'box',
};
/**
 * Терминальный статус каждого типа задачи. ПРОПУЩЕННЫЙ здесь тип даёт вечный
 * бейдж на пункте меню: задача закрыта, `taskVariant` не считает её готовой,
 * счётчик «только открытые» продолжает её считать — и никто не понимает,
 * что именно горит. Соответствие сторожит `warehouseTaskTypes.test.ts`.
 */
export const TERMINAL = {
  material_receipt: 'accepted', subcontract_send: 'sent',
  subcontract_receipt: 'accepted', marking: 'issued',
  fg_receipt: 'accepted', pack_ship: 'shipped',
};
// Порядок в списке повторяет ход заказа: материалы → передача подрядчику →
// приёмка подряда → маркировка → приёмка готовой продукции → упаковка.
// Передача стоит ПЕРЕД приёмкой: сначала отдаём, потом забираем (п. 3)
export const TYPE_ORDER = {
  material_receipt: 0, subcontract_send: 1, subcontract_receipt: 2,
  marking: 3, fg_receipt: 4, pack_ship: 5,
};
const RECEIPT_LABELS = { awaiting: 'Ожидает приёмки', accepted: 'Принято', awaiting_receipt: 'Ожидает приёмки' };

/**
 * РАБОЧИЕ ВКЛАДКИ СКЛАДА (правка заказчика 05.10, п. 8).
 *
 * «В общем списке смешаны материалы, подряд, готовые изделия и отгрузки…
 * Сделать рабочие вкладки: приёмка материалов, готовые изделия, подряд,
 * отгрузка; „Все" отдельно. Маркировку и остальные действия сохранить
 * внутри нужных операций».
 *
 * Шесть типов задач — четыре операции. Маркировка — операция над готовым
 * изделием (бирка «Честного знака» клеится на принятую продукцию), поэтому
 * она во вкладке готовых изделий, рядом с их приёмкой; передача подрядчику
 * и приёмка от него — один подряд. Каждый тип обязан попасть РОВНО в одну
 * вкладку, иначе задача пропадёт со всех, кроме «Все», — сторож
 * `warehouseTaskTypes.test.ts`.
 */
export const TABS = [
  { key: 'all', label: 'Все', types: null },
  { key: 'materials', label: 'Приёмка материалов', types: ['material_receipt'] },
  { key: 'goods', label: 'Готовые изделия', types: ['fg_receipt', 'marking'] },
  { key: 'subcontract', label: 'Подряд', types: ['subcontract_send', 'subcontract_receipt'] },
  { key: 'shipping', label: 'Отгрузка', types: ['pack_ship'] },
];

/** Ключ вкладки из адреса: неизвестный читается «Все» */
export function tabOf(key) {
  return TABS.find((t) => t.key === key) ?? TABS[0];
}

export function isTaskInTab(task, tabKey) {
  const tab = tabOf(tabKey);
  return !tab.types || tab.types.includes(task.task_type);
}

export function isTaskOpen(task) {
  return task.status !== TERMINAL[task.task_type];
}

export function taskStatusLabel(task, order) {
  switch (task.task_type) {
    case 'marking': return MARKING_STATUS_LABELS[task.status] ?? task.status;
    /**
     * Частичная отгрузка называется в СТРОКЕ СПИСКА тоже (правка 30.08, п. 6):
     * статус задачи о ней не знает (она остаётся `ready_to_ship`), а склад
     * ищет заказ именно здесь. Подпись берётся у заказа — её ведёт триггер.
     */
    case 'pack_ship':
      return order?.shipped_status === 'partial' && task.status !== 'shipped'
        ? SHIPPED_STATUS_LABELS.partial
        : (PACK_SHIP_STATUS_LABELS[task.status] ?? task.status);
    case 'subcontract_send': return SUBCONTRACT_SEND_STATUS_LABELS[task.status] ?? task.status;
    case 'subcontract_receipt': return SUBCONTRACT_RECEIPT_STATUS_LABELS[task.status] ?? task.status;
    case 'fg_receipt': return FG_RECEIPT_STATUS_LABELS[task.status] ?? task.status;
    default: return RECEIPT_LABELS[task.status] ?? task.status;
  }
}

export function taskVariant(task) {
  if (task.status === TERMINAL[task.task_type]) return 'ready';
  if (task.status === 'awaiting' || task.status === 'awaiting_receipt' || task.status === 'new') return 'waiting';
  return 'progress';
}

/** Позиция закупки, которую принимает задача; нет её (старая задача) — `null` */
export function taskMaterial(order, task) {
  if (task.task_type !== 'material_receipt' || !task.material_id) return null;
  return (order.materials ?? []).find((m) => m.id === task.material_id) ?? null;
}

/**
 * ДЕЙСТВИЕ ЗАДАЧИ НАЗЫВАЕТ СЕБЯ (правка 05.10, п. 8): «везде одинаковое
 * „Открыть"… Подписи действия по задаче: „Принять ткань" / „Принять
 * материал", „Принять изделия", „Передать подрядчику", „Отгрузить" —
 * кнопка открывает форму, операцию сразу не проводит».
 *
 * Закрытая задача — «Открыть»: работы по ней нет, есть что посмотреть;
 * подпись глагола на закрытой приёмке звала бы принять второй раз.
 */
export function taskActionLabel(order, task) {
  if (!isTaskOpen(task)) return 'Открыть';
  switch (task.task_type) {
    case 'material_receipt':
      return taskMaterial(order, task)?.kind === 'fabric' ? 'Принять ткань' : 'Принять материал';
    case 'fg_receipt': return 'Принять изделия';
    case 'subcontract_send': return 'Передать подрядчику';
    case 'subcontract_receipt': return 'Принять от подрядчика';
    case 'marking': return 'Промаркировать';
    case 'pack_ship': return 'Отгрузить';
    default: return 'Открыть';
  }
}

/** Краткое «содержимое» задачи для колонки таблицы */
export function taskSummary(order, task) {
  if (task.task_type === 'subcontract_receipt') {
    /**
     * Подрядных приёмок у заказа может быть НЕСКОЛЬКО (сублимация и варка
     * у одной позиции), и подпись «Готовое изделие» не различала их вовсе.
     * Называем операцию и изделие.
     */
    for (const it of order.items ?? []) {
      const st = (it.stages ?? []).find((s) => s.id === task.stage_id);
      if (st) {
        const op = st.operation?.trim() || 'Подряд';
        return `${op} · ${it.product_type}${it.variant ? ` (${it.variant})` : ''}`;
      }
    }
    return 'Готовое изделие';
  }
  if (task.task_type === 'material_receipt') {
    /**
     * ЗАДАЧА НАЗЫВАЕТ СВОЙ МАТЕРИАЛ (правка 12.09, баг 01): приёмка
     * принадлежит ПОЗИЦИИ закупки, и «3 материала» не отвечало бы на вопрос,
     * что именно приехало.
     */
    if (task.material_id) {
      const m = taskMaterial(order, task);
      if (!m) return 'Позиция закупки удалена';
      const qty = m.qty_expected ?? m.qty_ordered;
      return [m.name || 'Материал', m.color, qty ? `${qty} ${m.unit || ''}`.trim() : null]
        .filter(Boolean).join(' · ');
    }
    /* Приёмки, закрытые до правки, относятся к заказу целиком */
    const n = (order.materials ?? []).length;
    return `${n} ${n === 1 ? 'материал' : 'материалов'}`;
  }
  if (task.task_type === 'marking') return task.marking_type || 'Маркировка';
  if (task.task_type === 'fg_receipt') return `${orderQty(order)} шт с производства`;
  return 'Упаковка и отгрузка';
}

/**
 * Сколько принять по задаче материала: «осталось к приёмке» позиции
 * с её единицей. Без позиции (старая задача) — `null`.
 */
export function receiptQtyLabel(order, task) {
  const m = taskMaterial(order, task);
  if (!m) return null;
  const left = qtyLeftToAccept(m);
  if (left == null) return null;
  return `${left}${m.unit ? ` ${m.unit}` : ''}`;
}

/**
 * СРОК ЗАДАЧИ.
 *
 * Приёмка материала живёт СРОКОМ ПОСТАВКИ (правка 05.10, п. 8): «в приёмке
 * срок поставки (`erp_materials.eta_date`), а не срок заказа; не указан —
 * „не задан"; срок заказа — отдельной подписью». Кладовщика интересует,
 * когда приедет машина, а не когда заказ сдаётся клиенту.
 *
 * Остальные задачи — свой срок либо срок заказа (§3.4 обхода 04.09): свой
 * `deadline` не ставит почти никто, а срок сдачи заказа и есть величина,
 * по которой склад расставляет приоритет. `kind` отвечает, чей срок
 * показан, — иначе разные величины в одной колонке неразличимы.
 *
 * @returns {{ date: string|null, kind: 'eta'|'own'|'order' }}
 */
export function taskDeadline(order, task) {
  if (task.task_type === 'material_receipt' && task.material_id) {
    return { date: taskMaterial(order, task)?.eta_date ?? null, kind: 'eta' };
  }
  if (task.deadline) return { date: task.deadline, kind: 'own' };
  return { date: order.due_date ?? null, kind: 'order' };
}

/**
 * Подпись срока. Чужой срок называет себя («· срок заказа»), пустой
 * срок поставки — «не задан»: прочерк читался бы как «срока нет вовсе».
 */
export function deadlineLabel(order, task) {
  const { date, kind } = taskDeadline(order, task);
  if (kind === 'eta') return date ? formatDateShort(date) : 'не задан';
  if (!date) return '';
  const text = formatDateShort(date);
  return kind === 'own' ? text : `${text} · срок заказа`;
}

/** Срок заказа отдельной подписью — у приёмки материала, где колонка про поставку */
export function orderDueNote(order, task) {
  if (taskDeadline(order, task).kind !== 'eta' || !order.due_date) return '';
  return `срок заказа ${formatDateShort(order.due_date)}`;
}

/**
 * ФИЛЬТР ПО СРОКАМ (правка 05.10, п. 8): «просрочено / 3 дня / неделя».
 * Срок — тот же, что в колонке (`taskDeadline`). Задача без срока ни в один
 * из фильтров не попадает: «не задан» не значит «горит».
 * «3 дня» и «неделя» — окно ВПЕРЁД от сегодня, просроченное в них
 * не входит: у него свой фильтр, и смешивать «уже поздно» с «скоро»
 * значило бы снова показывать всё подряд.
 */
export const DUE_FILTERS = [
  { key: 'overdue', label: 'Просрочено' },
  { key: 'd3', label: '3 дня' },
  { key: 'week', label: 'Неделя' },
];

export function matchesDue(order, task, due, today) {
  if (!due) return true;
  const { date } = taskDeadline(order, task);
  if (!date) return false;
  if (due === 'overdue') return date < today;
  if (due === 'd3') return date >= today && date <= addDays(today, 3);
  if (due === 'week') return date >= today && date <= addDays(today, 7);
  return true;
}

/**
 * ПОИСК ПО ВСЕМ ЗАПИСЯМ (правка 05.10, п. 8): «искать по всем записям
 * (включая название материала задачи), не только по странице». Список
 * фильтруется ДО пагинации, а в совпадение входит содержимое задачи
 * (материал, цвет, операция подряда) и поставщик позиции, а не только поля
 * заказа: «Тест новый» — название материала, и по заказу его не найти.
 */
export function matchesTaskQuery(order, task, q) {
  if (!q) return true;
  const m = taskMaterial(order, task);
  /*
    У приёмки своей позиции заказ сравнивается БЕЗ чужих материалов:
    общий матчер ищет и по материалам заказа, и «Тест новый» находил бы
    все четырнадцать приёмок того же заказа — нужная снова терялась
    на последней странице.
  */
  if (matchesOrderQuery(m ? { ...order, materials: [], items: [] } : order, q)) return true;
  if (taskSummary(order, task).toLowerCase().includes(q)) return true;
  return Boolean(m?.supplier && m.supplier.toLowerCase().includes(q));
}

/**
 * Значение колонки для сортировки — то же, что видно в ячейке.
 * Срок сортируется по ISO-строке даты: она уже лексикографически монотонна.
 */
export function warehouseSortValue({ order, task }, key) {
  switch (key) {
    case 'type': return WAREHOUSE_TASK_TYPE_LABELS[task.task_type];
    case 'order': return order.bitrix_id || order.title;
    case 'summary': return taskSummary(order, task);
    case 'status': return taskStatusLabel(task, order);
    case 'deadline': return taskDeadline(order, task).date;
    default: return null;
  }
}
