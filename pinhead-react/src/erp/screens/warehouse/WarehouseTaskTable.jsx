import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { SortableTh } from '../../components/SortableTh';
import { WAREHOUSE_TASK_TYPE_LABELS } from '../../types';
import { WarehouseTaskCard } from './WarehouseTaskCard';
import {
  TYPE_ICON, deadlineLabel, orderDueNote, receiptQtyLabel, taskActionLabel,
  taskMaterial, taskStatusLabel, taskSummary, taskVariant,
} from './warehouseTasks';
import styles from '../../styles';

/**
 * СПИСОК ЗАДАЧ СКЛАДА — таблица (десктоп) и карточки (планшет).
 *
 * Вынесен из `Warehouse.jsx` 05.10 (правка п. 8): экран стоял на потолке
 * ратчета размера, а у списка появились две раскладки колонок.
 *
 * ВКЛАДКА ПРИЁМКИ МАТЕРИАЛОВ — СВОИ КОЛОНКИ: «заказ, материал и цвет,
 * поставщик (под материалом), количество к приёмке, срок поставки,
 * действие». Общий вид («Тип · Заказ · Содержимое · Статус · Срок») для неё
 * не годился: тип одинаков у всех строк, а «срок» показывал срок заказа,
 * когда кладовщику нужно, когда приедет машина. Остальные вкладки
 * и «Все» — общий вид. Кнопка в любом виде называет операцию задачи
 * (`taskActionLabel`) и открывает форму, а не проводит операцию.
 */

function MaterialName({ order, task }) {
  const m = taskMaterial(order, task);
  if (!m) return taskSummary(order, task);
  return (
    <>
      <strong>{m.name}</strong>{m.color ? ` · ${m.color}` : ''}
      <div className={styles.subText}>{m.supplier ? `поставщик: ${m.supplier}` : 'поставщик не указан'}</div>
    </>
  );
}

function OrderCellText({ order }) {
  return (
    <>№{order.bitrix_id || '—'}<div className={styles.cellSub} title={order.title}>{order.title}</div></>
  );
}

/** Поля карточки планшета — тот же набор, что колонки таблицы этой вкладки */
function cardFields(order, task, materials) {
  if (materials) {
    const m = taskMaterial(order, task);
    return [
      { label: 'Материал', value: taskSummary(order, task), note: m?.supplier ? `поставщик: ${m.supplier}` : null },
      { label: 'К приёмке', value: receiptQtyLabel(order, task) },
      { label: 'Срок поставки', value: deadlineLabel(order, task), note: orderDueNote(order, task) || null },
    ];
  }
  return [
    { label: 'Содержимое', value: taskSummary(order, task) },
    { label: 'Срок', value: deadlineLabel(order, task), note: orderDueNote(order, task) || null },
  ];
}

/**
 * Поля карточки — ТОТ ЖЕ массив, пока не изменились задача, заказ и вкладка.
 * Новый массив на каждый рендер списка обнулял `memo` у всех карточек сразу.
 * Ключ — сама задача (объект из стора): заменили — запись уходит с ней.
 */
const fieldsCache = new WeakMap();
function cachedCardFields(order, task, materials) {
  const hit = fieldsCache.get(task);
  if (hit && hit.order === order && hit.materials === materials) return hit.fields;
  const fields = cardFields(order, task, materials);
  fieldsCache.set(task, { order, materials, fields });
  return fields;
}

export function WarehouseTaskTable({ rows, materials, compact, sort, onSort, onOpen }) {
  if (compact) {
    return (
      <div className={styles.dataCardList}>
        {rows.map(({ order, task }) => (
          <WarehouseTaskCard
            key={task.id}
            taskId={task.id}
            typeLabel={WAREHOUSE_TASK_TYPE_LABELS[task.task_type]}
            typeIcon={TYPE_ICON[task.task_type]}
            orderId={order.id}
            orderNo={order.bitrix_id}
            orderTitle={order.title}
            statusLabel={taskStatusLabel(task, order)}
            statusVariant={taskVariant(task)}
            fields={cachedCardFields(order, task, materials)}
            actionLabel={taskActionLabel(order, task)}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  }

  const action = (order, task) => (
    <Button variant="secondary" onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}>
      {taskActionLabel(order, task)}
    </Button>
  );

  return (
    <ScrollHintBox className={styles.tableWrap} label="Задачи склада">
      <table className={styles.table}>
        <thead>
          {materials ? (
            <tr>
              <SortableTh sortKey="order" sort={sort} onSort={onSort}>Заказ</SortableTh>
              <SortableTh sortKey="summary" sort={sort} onSort={onSort}>Материал и цвет</SortableTh>
              <th>К приёмке</th>
              <SortableTh sortKey="deadline" sort={sort} onSort={onSort}>Срок поставки</SortableTh>
              <SortableTh sortKey="status" sort={sort} onSort={onSort}>Статус</SortableTh>
              <th>Действие</th>
            </tr>
          ) : (
            <tr>
              <SortableTh sortKey="type" sort={sort} onSort={onSort}>Тип задачи</SortableTh>
              <SortableTh sortKey="order" sort={sort} onSort={onSort}>Заказ</SortableTh>
              <SortableTh sortKey="summary" sort={sort} onSort={onSort}>Содержимое</SortableTh>
              <SortableTh sortKey="status" sort={sort} onSort={onSort}>Статус</SortableTh>
              <SortableTh sortKey="deadline" sort={sort} onSort={onSort}>Срок</SortableTh>
              <th>Действие</th>
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map(({ order, task }) => {
            const note = orderDueNote(order, task);
            const deadline = (
              <td>
                {deadlineLabel(order, task) || '—'}
                {note && <div className={styles.subText}>{note}</div>}
              </td>
            );
            const status = <td><Badge variant={taskVariant(task)}>{taskStatusLabel(task, order)}</Badge></td>;
            return (
              <tr key={task.id} className={styles.rowClickable} onClick={() => onOpen(task.id)}>
                {materials ? (
                  <>
                    <td><OrderCellText order={order} /></td>
                    <td><MaterialName order={order} task={task} /></td>
                    <td>{receiptQtyLabel(order, task) ?? '—'}</td>
                    {deadline}
                    {status}
                  </>
                ) : (
                  <>
                    <td>
                      <span className={styles.cellWithIcon}>
                        <Icon name={TYPE_ICON[task.task_type]} size={15} />
                        {WAREHOUSE_TASK_TYPE_LABELS[task.task_type]}
                      </span>
                    </td>
                    <td><OrderCellText order={order} /></td>
                    <td>{taskSummary(order, task)}</td>
                    {status}
                    {deadline}
                  </>
                )}
                <td>{action(order, task)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollHintBox>
  );
}
