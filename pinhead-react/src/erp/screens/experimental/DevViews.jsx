import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Badge } from '../../components/Badge';
import { ButtonLink } from '../../components/Button';
import { EmptyResult } from '../../components/ErpStates';
import { OrderLink } from '../../components/OrderLink';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { DEV_TASK_STATUS_LABELS } from '../../types';
import { buildQueueEntries } from '../../utils/queueEntries';
import { DEV_STAGE_LABELS, devStageQueue, experimentalEntries } from '../../utils/experimentalBoard';
import { taskGroup, taskLabel, taskWaitingReason } from '../../utils/experimentalTasks';
import { missingFinalPackage } from '../../utils/finalPackage';
import { formatDateShort } from '../../utils/time';
import styles from '../../styles';

/**
 * Внутренние представления экспериментального цеха (правки заказчика 20.08).
 *
 * «Кроме главного борда по этапам, внутри раздела должны быть доступны:
 * Все разработки · Лекала · Крой · Шелкография · DTF · Вышивка · DTG ·
 * Пошив · Финальный этап. Лекала, крой и пошив работают как собственные
 * очереди экспериментального цеха. Шелкография, DTF, вышивка и DTG являются
 * ОТФИЛЬТРОВАННЫМИ ПРЕДСТАВЛЕНИЯМИ общих производственных задач».
 *
 * Отсюда два разных источника строк — и это не непоследовательность, а суть
 * требования: свои очереди читают задачи разработки (цеха у них нет вовсе),
 * а нанесения читают ЭТАПЫ, те же самые, что видит общий цех. Свой механизм
 * для нанесений означал бы дубль задачи, который документ запрещает прямо.
 */

const GROUP_VARIANT = {
  blocked: 'blocked',
  in_progress: 'progress',
  waiting: 'waiting',
  ready: 'info',
  awaiting_materials: 'waiting',
  done: 'ready',
  cancelled: 'skipped',
};

const QUEUE_GROUP_LABELS = {
  blocked: 'С проблемой',
  awaiting_materials: 'Ожидает материалы',
  waiting: 'Ожидает',
  ready: 'Готово к работе',
  in_progress: 'В работе',
  done: 'Завершено',
};

/** Собственная очередь ЭКС: задачи одного шага по всем разработкам */
function OwnQueue({ rows, stage, typeNames, onOpen }) {
  const list = useMemo(() => devStageQueue(rows, stage), [rows, stage]);

  if (list.length === 0) {
    return (
      <EmptyResult>
        {`На шаге «${DEV_STAGE_LABELS[stage]}» задач нет. Они заводятся в карточке разработки.`}
      </EmptyResult>
    );
  }

  return (
    <ScrollHintBox className={styles.tableWrap} label={DEV_STAGE_LABELS[stage]}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Разработка</th>
            <th>Задача</th>
            <th>Ответственный</th>
            <th>Срок</th>
            <th>Состояние</th>
          </tr>
        </thead>
        <tbody>
          {list.map(({ row, task }) => {
            const group = taskGroup(task, row.tasks);
            const reason = taskWaitingReason(
              task, row.tasks, typeNames, null, task.department_id);
            return (
              <tr
                key={task.id}
                className={styles.rowClickable}
                onClick={() => onOpen(row.dev.id)}
              >
                <td>
                  {/*
                    ССЫЛКА В ПЕРВОЙ ЯЧЕЙКЕ (правка 03.09). Строка открывалась
                    ТОЛЬКО кликом по `<tr>`: ни `tabIndex`, ни обработчика
                    клавиш, ни единого фокусируемого элемента внутри — с
                    клавиатуры разработку было не открыть вовсе (WCAG 2.1.1).
                    Доска не выручала: `DevBoard` исключает завершённые
                    (`handed_to_warehouse_at`, `outcome`), то есть к ним пути
                    не было совсем. Именно ссылка, а не кнопка: это переход,
                    и Ctrl+клик с «открыть в новой вкладке» должны работать.
                  */}
                  <Link
                    to={`/experimental/${row.dev.id}`}
                    className={styles.queueCardTitleLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <strong>{row.dev.tech_name || 'Без названия'}</strong>
                  </Link>
                  <div className={styles.cellSub}>
                    №{row.dev.order?.bitrix_id || '—'} · {row.dev.order?.title || ''}
                  </div>
                </td>
                <td>
                  {taskLabel(task, typeNames)}
                  {task.cycle > 0 && (
                    <span className={styles.cellSub}> круг {task.cycle}</span>
                  )}
                </td>
                <td>
                  {task.responsible
                    || <span className={styles.subText}>не назначен</span>}
                </td>
                <td>{task.due_date ? formatDateShort(task.due_date) : '—'}</td>
                <td>
                  <Badge variant={GROUP_VARIANT[group]}>
                    {DEV_TASK_STATUS_LABELS[task.status] ?? task.status}
                  </Badge>
                  {reason && <div className={styles.cellSub}>{reason}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollHintBox>
  );
}

/**
 * Нанесения: ТЕ ЖЕ этапы, что в общем цехе, отобранные по `origin`.
 * Строка ведёт на само задание — работает цех там, где работал всегда.
 */
function BrandingQueue({ orders, departments, deptCode }) {
  const location = useLocation();
  const dept = (departments ?? []).find((d) => d.code === deptCode) ?? null;
  const entries = useMemo(() => (dept
    ? experimentalEntries(buildQueueEntries(orders, departments, { departmentId: dept.id }))
    : []), [orders, departments, dept]);

  if (!dept) {
    return <EmptyResult>{`Участок «${deptCode}» не заведён в справочнике цехов.`}</EmptyResult>;
  }
  if (entries.length === 0) {
    return (
      <EmptyResult>
        {`Заданий образцов на участке «${dept.name}» нет. Задача попадает сюда, `
          + 'когда её передают в цех из карточки разработки.'}
      </EmptyResult>
    );
  }

  return (
    <ScrollHintBox className={styles.tableWrap} label={dept.name}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Заказ</th>
            <th>Изделие</th>
            <th>Тираж</th>
            <th>Состояние</th>
            <th>Задание</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ order, item, stage, group, reason }) => (
            <tr key={stage.id}>
              <td>
                <OrderLink orderId={order.id}>№{order.bitrix_id || '—'}</OrderLink>
                <div className={styles.cellSub}>{order.title}</div>
              </td>
              <td>
                {item.product_type}
                {/* Пометка образца видна и здесь: строка та же, что в общем цехе */}
                <span className={`${styles.chip} ${styles.chipNeutral}`}>ЭКС / ОБРАЗЕЦ</span>
              </td>
              <td>{stage.qty_done ?? 0} / {item.qty}</td>
              <td>
                <Badge variant={GROUP_VARIANT[group]}>
                  {QUEUE_GROUP_LABELS[group] ?? group}
                </Badge>
                {reason && <div className={styles.cellSub}>{reason}</div>}
              </td>
              <td>
                {/* Ссылка несёт текущий адрес: возврат из задания обязан
                    привести в то же представление, откуда ушли */}
                <ButtonLink
                  to={`/task/${stage.id}`}
                  state={{ from: `${location.pathname}${location.search}` }}
                  variant="ghost"
                >
                  Открыть
                </ButtonLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollHintBox>
  );
}

/** Финальный этап: что осталось до «Готово к серии» у каждой разработки */
function FinalQueue({ rows, onOpen }) {
  const list = useMemo(
    () => rows.filter(({ dev }) => dev.sample_approved_at || dev.outcome),
    [rows]);

  if (list.length === 0) {
    return (
      <EmptyResult>
        Ни один образец ещё не утверждён. Разработка попадает сюда после
        отметки «Образец утверждён» в карточке.
      </EmptyResult>
    );
  }

  return (
    <ScrollHintBox className={styles.tableWrap} label="Финальный этап">
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Разработка</th>
            <th>Лекала</th>
            <th>Ценовая вилка</th>
            <th>Чего не хватает</th>
          </tr>
        </thead>
        <tbody>
          {list.map(({ dev }) => {
            const missing = missingFinalPackage(dev, dev.attachments ?? []);
            return (
              <tr key={dev.id} className={styles.rowClickable} onClick={() => onOpen(dev.id)}>
                <td>
                  <Link
                    to={`/experimental/${dev.id}`}
                    className={styles.queueCardTitleLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <strong>{dev.tech_name || 'Без названия'}</strong>
                  </Link>
                  <div className={styles.cellSub}>
                    №{dev.order?.bitrix_id || '—'} · {dev.order?.title || ''}
                  </div>
                </td>
                <td>
                  {dev.pattern_tech_name || <span className={styles.subText}>—</span>}
                  {dev.pattern_version && (
                    <div className={styles.cellSub}>{dev.pattern_version}</div>
                  )}
                </td>
                <td>
                  {dev.price_min != null && dev.price_max != null
                    ? `${dev.price_min} — ${dev.price_max}`
                    : <span className={styles.subText}>—</span>}
                </td>
                <td>
                  {missing.length === 0
                    ? <Badge variant="ready">пакет заполнен</Badge>
                    : <span className={styles.subText}>{missing.join(', ')}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollHintBox>
  );
}

export function DevViews({ view, rows, orders, departments, typeNames, onOpen }) {
  if (view === 'final') return <FinalQueue rows={rows} onOpen={onOpen} />;
  if (view === 'patterns' || view === 'cutting' || view === 'sewing') {
    return <OwnQueue rows={rows} stage={view} typeNames={typeNames} onOpen={onOpen} />;
  }
  return <BrandingQueue orders={orders} departments={departments} deptCode={view} />;
}
