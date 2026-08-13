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
  MATERIAL_KIND_LABELS,
  PROCUREMENT_STATUS_LABELS,
  SUBCONTRACT_STATUS_LABELS,
  PRODUCTION_TYPE_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
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

  'item.qty': 'Позиция: тираж',
  'item.product_type': 'Позиция: изделие',
  'item.production_type': 'Позиция: тип производства',
  'item.variant': 'Позиция: вариант',
  'item.notes': 'Позиция: заметка',

  'procurement.status': 'Закупка: статус',
  'procurement.required_qty': 'Закупка: нужно',
  'procurement.supplier': 'Закупка: поставщик',
  'procurement.planned_date': 'Закупка: плановая дата',
  'procurement.responsible': 'Закупка: ответственный',

  'subcontract.status': 'Подряд: статус',
  'subcontract.contractor': 'Подряд: подрядчик',
  'subcontract.qty': 'Подряд: количество',
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
 * Словарь значений аудита: поле → как читать его значение по-русски.
 *
 * Таблицей, а не цепочкой `if` (M-07 отчёта QA 13.08.2026). Ветки покрывали
 * шесть полей из тридцати с лишним, и в истории попадались сырые коды —
 * `accepted_full` вместо «принято полностью». Заметить пропуск в цепочке
 * нельзя: она не падает, она просто печатает то, что пришло из базы.
 * У таблицы пропуск виден сразу — поле есть в подписях, а в значениях нет,
 * и это сторожит `HistorySection.test.jsx`.
 *
 * Поле, у которого значение и так человеческое (название, комментарий,
 * имя исполнителя), в таблице не нужно — там нечего переводить.
 */
const AUDIT_VALUE_LABELS = {
  status: ORDER_STATUS_LABELS,
  shipped_status: SHIPPED_STATUS_LABELS,
  packaging: PACKAGING_LABELS,
  stickers: STICKERS_LABELS,
  // Статус этапа — своя машина состояний, а не статус заказа. Поле называется
  // одинаково у обоих, поэтому префикс обязателен.
  'stage.status': STAGE_STATUS_LABELS,
  'material.status': MATERIAL_STATUS_LABELS,
  'material.accept_status': MATERIAL_ACCEPT_LABELS,
  'material.kind': MATERIAL_KIND_LABELS,
  'procurement.status': PROCUREMENT_STATUS_LABELS,
  'subcontract.status': SUBCONTRACT_STATUS_LABELS,
  'item.production_type': PRODUCTION_TYPE_LABELS,
};

/** Читабельные значения аудита: статусы, даты и флаги — на русском */
function auditValue(field, v) {
  if (v == null || v === '') return '—';
  const labels = AUDIT_VALUE_LABELS[field];
  if (labels) return labels[v] || v;
  if (field === 'no_chestny_znak') return v === 'true' ? 'да' : 'нет';
  if (AUDIT_DATE_FIELDS.has(field)) return fmt(v);
  return v;
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
