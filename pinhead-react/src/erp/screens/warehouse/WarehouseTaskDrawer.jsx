import { useShallow } from 'zustand/react/shallow';
import { Badge } from '../../components/Badge';
import { ButtonLink } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { ReadOnlyFieldset } from '../../components/ReadOnlyFieldset';
import { useErpStore } from '../../store/useErpStore';
import { WAREHOUSE_TASK_TYPE_LABELS } from '../../types';
import { MaterialReceiptCard } from './MaterialReceiptCard';
import { FgReceiptCard } from './FgReceiptCard';
import { MarkingCard } from './MarkingCard';
import { PackShipCard } from './PackShipCard';
import { SubcontractReceiptCard } from './SubcontractReceiptCard';
import { SendToContractorCard } from './SendToContractorCard';
import { taskStatusLabel, taskVariant } from './warehouseTasks';
import styles from '../../styles';

/**
 * ПАНЕЛЬ ЗАДАЧИ СКЛАДА: форма операции в правом Drawer (переиспользуются
 * карточки приёмки/маркировки/упаковки). Вынесена из `Warehouse.jsx` 05.10
 * (правка п. 8) — экран стоял на потолке ратчета размера.
 *
 * ПРИЁМКА МАТЕРИАЛА — В ШИРОКОЙ ПАНЕЛИ (правка 05.10, п. 4): в 560px
 * строка рулона разбивалась на две.
 *
 * ВОЗВРАТ В ЗАКУПКУ (правка 05.10, п. 7): открытая из строки закупки
 * приёмка несёт ссылку «← К закупке» — «возврат ведёт в ту же закупку…
 * с теми же фильтрами». Адрес возврата собирает экран (`returnHref`).
 *
 * @param open       `{ order, task }` — свежие из стора
 * @param returnHref адрес закупки, если пришли из неё; иначе `null`
 */
export function WarehouseTaskDrawer({ open, onClose, canManage, returnHref }) {
  const {
    acceptMaterial, setRollWeights, setRollParams, addMaterialRolls,
    advanceWarehouseTask, shipOrder, submitWarehouseReport,
  } = useErpStore(useShallow((s) => ({
    acceptMaterial: s.acceptMaterial, setRollWeights: s.setRollWeights, setRollParams: s.setRollParams,
    addMaterialRolls: s.addMaterialRolls, advanceWarehouseTask: s.advanceWarehouseTask,
    shipOrder: s.shipOrder, submitWarehouseReport: s.submitWarehouseReport,
  })));

  return (
    <Drawer
      wide={open.task.task_type === 'material_receipt'}
      onClose={onClose}
      title={`${WAREHOUSE_TASK_TYPE_LABELS[open.task.task_type]}`}
      subtitle={`№${open.order.bitrix_id || '—'} · ${open.order.title}`}
      badge={<Badge variant={taskVariant(open.task)}>{taskStatusLabel(open.task, open.order)}</Badge>}
    >
      {returnHref && (
        <div className={styles.drawerBackRow}>
          <ButtonLink to={returnHref} variant="ghost" icon="chevronLeft">К закупке</ButtonLink>
        </div>
      )}
      <ReadOnlyFieldset
        canManage={canManage}
        note="Только просмотр: движение складских задач ведёт кладовщик."
      >
        {open.task.task_type === 'material_receipt' && (
          <MaterialReceiptCard
            order={open.order}
            task={open.task}
            onAccept={acceptMaterial}
            onSetRollWeights={setRollWeights} onSetRollParams={setRollParams} onAddRolls={addMaterialRolls}
          />
        )}
        {open.task.task_type === 'subcontract_send' && (
          <SendToContractorCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
        )}
        {open.task.task_type === 'subcontract_receipt' && (
          <SubcontractReceiptCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
        )}
        {open.task.task_type === 'fg_receipt' && (
          <FgReceiptCard order={open.order} task={open.task} onSubmit={submitWarehouseReport} />
        )}
        {open.task.task_type === 'marking' && (
          <MarkingCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
        )}
        {open.task.task_type === 'pack_ship' && (
          <PackShipCard
            order={open.order}
            task={open.task}
            onAdvance={advanceWarehouseTask}
            /* Отгрузка идёт своим путём (правка 30.08, п. 6): она пишет
               журнал по позициям и сама закрывает задачу при полной
               передаче — `advanceWarehouseTask` для неё слишком груб */
            onShip={shipOrder}
          />
        )}
      </ReadOnlyFieldset>
    </Drawer>
  );
}
