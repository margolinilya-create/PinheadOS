import { useMemo, useState } from 'react';
import { Skeleton } from '../../../components/shared/Skeleton';
import { deptShortName } from '../../data/departments';
import {
  ORDER_STATUS_LABELS,
  SHIPPED_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
  MATERIAL_STATUS_LABELS,
  MATERIAL_ACCEPT_LABELS,
  PROCUREMENT_STATUS_LABELS,
  SUBCONTRACT_PHASE_LABELS,
  SUBCONTRACT_STATUS_LABELS,
} from '../../types';
import styles from '../../styles';
import { fmt, fmtTs } from './format';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { Button } from '../../components/Button';

const AUDIT_FIELD_LABELS = {
  title: 'Название',
  customer: 'Клиент',
  manager: 'Менеджер',
  bitrix_id: '№ сделки',
  launch_date: 'Дата запуска',
  due_date: 'Срок клиента',
  buffer_days: 'Буфер, дн',
  priority: 'Приоритет',
  status: 'Статус заказа',
  shipped_status: 'Отгрузка',
  delivered_at: 'Сдан',
  notes: 'Заметка',
  packaging: 'Упаковка',
  packaging_note: 'Упаковка: уточнение',
  stickers: 'Стикеры',
  stickers_note: 'Стикеры: уточнение',
  no_chestny_znak: 'Без Честного знака',
  planned_start: 'План этапа: начало',
  planned_end: 'План этапа: конец',

  // Поля из общего триггера аудита (B5). Префикс обязателен: `status` есть
  // и у заказа, и у этапа, и у материала, а `field_name` в аудите один на всех —
  // без него смена статуса материала подписывалась бы «Статус заказа».
  'stage.status': 'Этап: статус',
  'stage.qty_done': 'Этап: сделано',
  'stage.qty_rework': 'Этап: в переделку',
  'stage.assignee': 'Этап: исполнитель',
  'stage.department_id': 'Этап: цех',
  'stage.block_reason': 'Этап: причина блокировки',

  'material.status': 'Материал: статус',
  'material.accept_status': 'Материал: приёмка',
  'material.qty_expected': 'Материал: ожидается',
  'material.qty_received': 'Материал: принято',
  'material.eta_date': 'Материал: ожидаемая дата',
  'material.supplier': 'Материал: поставщик',
  'material.responsible': 'Материал: ответственный',
  'material.name': 'Материал: название',
  'material.kind': 'Материал: вид',
  // Закупочные величины: до 05.09 журнал их не видел вовсе — «сколько
  // заказали, когда и почём» не оставляло следа
  'material.qty_ordered': 'Материал: заказано',
  'material.ordered_on': 'Материал: дата заказа',
  'material.price': 'Материал: цена',

  'item.qty': 'Позиция: тираж',
  'item.product_type': 'Позиция: изделие',
  'item.variant': 'Позиция: вариант',
  'item.notes': 'Позиция: заметка',

  'procurement.status': 'Закупка: статус',
  'procurement.required_qty': 'Закупка: нужно',
  'procurement.supplier': 'Закупка: поставщик',
  'procurement.planned_date': 'Закупка: плановая дата',
  'procurement.responsible': 'Закупка: ответственный',

  'subcontract.phase': 'Подряд: этап',
  'subcontract.status': 'Подряд: этап',
  'subcontract.contractor': 'Подряд: подрядчик',
  'subcontract.qty': 'Подряд: в работе',
  // Суть подряда: сколько отдали, сколько вернулось, сколько брака.
  // До 05.09 журнал видел только план (`qty`)
  'subcontract.qty_sent': 'Подряд: передано',
  'subcontract.qty_returned': 'Подряд: вернулось',
  'subcontract.qty_defect': 'Подряд: брак',
  'subcontract.planned_date': 'Подряд: плановая дата',
  'subcontract.returned_date': 'Подряд: возвращено',
  'subcontract.delay_comment': 'Подряд: причина задержки',
};

/** Поля-даты аудита — показываем в русском формате */
const AUDIT_DATE_FIELDS = new Set([
  'launch_date', 'due_date', 'delivered_at', 'planned_start', 'planned_end',
  'material.eta_date', 'procurement.planned_date',
  'subcontract.planned_date', 'subcontract.returned_date',
]);

/**
 * ПОЛЕ АУДИТА → СЛОВАРЬ ЕГО ЗНАЧЕНИЙ.
 *
 * До 05.09 переводились только пять полей, а `material.status`,
 * `material.accept_status`, `subcontract.status` и `procurement.status`
 * показывались КАК ЕСТЬ. Менеджер читал в истории заказа
 * «ordered → in_transit» и «sent → received_at_pinhead» — сырые
 * идентификаторы в русском интерфейсе, 150 записей из 672 на боевой базе.
 * Подписи при этом всё это время лежали в `types.ts`.
 *
 * Таблицей, а не цепочкой `if`: новое поле аудита добавляется одной строкой,
 * и сторож `historyLabels.test.ts` сверяет её с полями триггеров.
 */
const AUDIT_VALUE_LABELS = {
  // Статус этапа — своя машина состояний, а не статус заказа. Поля называются
  // одинаково у обоих, и подмена словаря была бы незаметной.
  'stage.status': STAGE_STATUS_LABELS,
  status: ORDER_STATUS_LABELS,
  shipped_status: SHIPPED_STATUS_LABELS,
  packaging: PACKAGING_LABELS,
  stickers: STICKERS_LABELS,
  'material.status': MATERIAL_STATUS_LABELS,
  'material.accept_status': MATERIAL_ACCEPT_LABELS,
  'procurement.status': PROCUREMENT_STATUS_LABELS,
  /**
   * ДВА СЛОВАРЯ НА ОДНО ПОЛЕ, И ЭТО НЕ ОШИБКА. С 05.09 триггер пишет `phase`,
   * но в базе остались 37 записей, сделанных до правки, — они в старом
   * словаре (`received_at_pinhead`, `ready_to_ship`, `awaiting_materials`).
   * История не переписывается задним числом: показываем как есть, но
   * по-русски. Сначала актуальный словарь, потом legacy.
   */
  'subcontract.phase': SUBCONTRACT_PHASE_LABELS,
  'subcontract.status': { ...SUBCONTRACT_STATUS_LABELS, ...SUBCONTRACT_PHASE_LABELS },
};

/** Читабельные значения аудита: статусы, даты и флаги — на русском */
function auditValue(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'no_chestny_znak') return v === 'true' ? 'да' : 'нет';
  if (AUDIT_DATE_FIELDS.has(field)) return fmt(v);
  const dict = AUDIT_VALUE_LABELS[field];
  return (dict && dict[v]) || v;
}

/** Секция «История»: события этапов + правки заказа, слитые и отсортированные */
const HISTORY_PAGE = 120;

export function HistorySection({ events, audit, stageById, deptById }) {
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const allRows = useMemo(() => [
    ...(events ?? []).map((ev) => ({ kind: 'stage', at: ev.created_at, row: ev })),
    ...(audit ?? []).map((a) => ({ kind: 'audit', at: a.changed_at, row: a })),
  ].sort((x, y) => y.at.localeCompare(x.at)), [events, audit]);
  const shown = useMemo(() => allRows.slice(0, limit), [allRows, limit]);

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <strong>История</strong>
        {/* Тихих лимитов не ставим (правило проекта): раньше список молча резался
            до 120 событий, и понять, что показано не всё, было нельзя */}
        {allRows.length > shown.length && (
          <span className={styles.subText}>
            показаны последние {shown.length} из {allRows.length}
            {' '}
            <Button variant="ghost" onClick={() => setLimit(allRows.length)}>
              Показать все
            </Button>
          </span>
        )}
      </div>
      {events === null && <Skeleton width="45%" height={12} />}
      {events && events.length === 0 && (!audit || audit.length === 0) && (
        <div className={styles.subText}>Событий пока нет — история пишется при смене статусов и правках.</div>
      )}
      {events && (events.length > 0 || (audit && audit.length > 0)) && (
        <ScrollHintBox className={styles.tableWrap} label="История изменений">
          <table className={styles.table}>
            <thead>
              <tr><th>Когда</th><th>Кто</th><th>Этап</th><th>Что</th></tr>
            </thead>
            <tbody>
              {shown
                .map(({ kind, row }) => {
                  if (kind === 'audit') {
                    return (
                      <tr key={`a-${row.id}`}>
                        <td className={styles.subText}>{fmtTs(row.changed_at)}</td>
                        <td>{row.changed_by || '—'}</td>
                        <td><span className={`${styles.chip} ${styles.chipNeutral}`}>правка</span></td>
                        <td>
                          {AUDIT_FIELD_LABELS[row.field_name] || row.field_name}:{' '}
                          <span className={styles.subText}>{auditValue(row.field_name, row.old_value)}</span>
                          {' → '}
                          <strong>{auditValue(row.field_name, row.new_value)}</strong>
                        </td>
                      </tr>
                    );
                  }
                  const ev = row;
                  const info = stageById.get(ev.stage_id);
                  const dept = info ? deptById.get(info.st.department_id) : null;
                  return (
                    <tr key={`e-${ev.id}`}>
                      <td className={styles.subText}>{fmtTs(ev.created_at)}</td>
                      <td>{ev.actor || '—'}</td>
                      <td>{dept ? deptShortName(dept.code, dept.name) : '—'}
                        {info?.it?.variant ? ` · ${info.it.variant}` : ''}
                      </td>
                      <td>
                        {STAGE_STATUS_LABELS[ev.to_status] || ev.to_status}
                        {ev.qty_done ? ` · ${ev.qty_done} шт` : ''}
                        {ev.qty_rework ? ` · брак ${ev.qty_rework} шт` : ''}
                        {ev.comment && <div className={styles.subText}>{ev.comment}</div>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </section>
  );
}
