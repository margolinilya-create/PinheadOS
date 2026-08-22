import { SUBCONTRACT_PHASE_LABELS, STAGE_STATUS_LABELS } from '../../types';
import { stageLabel, nextRouteStage, stageLocation } from '../../utils/outsourcing';
import { formatDateShort } from '../../utils/time';
import { RouteProgress } from '../../components/RouteProgress';
import { StageActions } from './StageActions';
import {
  MoveJournal, StageFilesBlock, MaterialsBlock, CostBlock, HandoffBlock,
} from './MoveJournal';
import styles from '../../erp.module.css';

/**
 * Раскрытая карточка подрядного этапа (правки заказчика 22.08, пп. 3.2–3.4).
 *
 * ЧТО БЫЛО НЕ ТАК. После раскрытия человек одновременно видел маршрут,
 * несколько статусов, прогресс по этапам, три количества, ответственного,
 * даты передачи и возврата, ТЗ, файлы, переданные материалы, стоимость,
 * журнал и управляющие кнопки — всё одинаковой визуальной важности. Главное
 * действие терялось среди служебных полей, а часть управления вообще жила
 * внутри блока с названием «Журнал», то есть выглядела историей.
 *
 * ЧТО ТЕПЕРЬ. Сверху — компактная рабочая строка ровно из того, что
 * перечисляет документ: операция · подрядчик · количество в работе · текущий
 * статус · срок · ГЛАВНОЕ ДЕЙСТВИЕ. Всё остальное — ниже, свёрнутыми блоками:
 * ТЗ и файлы · переданные материалы · стоимость · подробности передачи
 * и возврата · маршрут · история.
 *
 * Блоки — нативный `<details>`: клавиатура и скринридер работают без строчки
 * JS, тем же приёмом сделаны группы уведомлений.
 *
 * ОДНО ДЕЙСТВИЕ В ОДНОМ МЕСТЕ (п. 3.4). Кнопки живут только в шапке;
 * ни один свёрнутый блок не повторяет их. Приоритет («какая кнопка главная»)
 * задаёт `availableActions`, а не эта разметка.
 */
export function StageDetails({
  order, item, stage, sub, view, canManage, deptById, deptNameById,
}) {
  const next = nextRouteStage(item, stage);
  const deptName = (id) => deptNameById.get(id) || '—';

  return (
    <div className={styles.stackTight}>
      {/* Рабочая строка первого уровня — то, ради чего карточку открывают */}
      <div className={styles.checkRow}>
        <span className={styles.subText}>
          Операция: <strong>{stageLabel(stage, deptName(stage.department_id))}</strong>
        </span>
        <span className={styles.subText}>
          Подрядчик: <strong>{stage.contractor || '—'}</strong>
        </span>
        <span className={styles.subText}>
          {/* Количество в работе — НЕ то же, что физически передано (п. 3.8) */}
          В работе: <strong>{view.inWorkQty || '—'}</strong> шт
        </span>
        <span className={styles.subText}>
          Статус: <strong>{SUBCONTRACT_PHASE_LABELS[view.display]}</strong>
        </span>
        <span className={styles.subText}>
          Срок возврата: <strong>{sub?.planned_date ? formatDateShort(sub.planned_date) : '—'}</strong>
        </span>
      </div>

      <div className={styles.subText}>{stageLocation(item, stage, view.display)}</div>

      <StageActions op={sub} view={view} canManage={canManage} />

      {/*
        Количества показываем одной строкой и РАЗЛИЧАЯ «ждёт приёмки» и «брак»
        (п. 3.9): до приёмки непринятое — это просто непринятое, а не брак.
      */}
      <div className={styles.checkRow}>
        <span className={styles.subText}>
          {view.contractorMaterials
            ? 'материалы подрядчика · передавать нечего'
            : `физически передано ${sub?.qty_sent ?? 0}`}
          {' · '}вернулось {sub?.qty_returned ?? 0}
          {' · '}принято {sub?.qty_accepted ?? 0}
        </span>
        {view.awaitingAccept > 0 && (
          <span className={`${styles.chip} ${styles.chipWaiting}`}>
            ожидает приёмки: {view.awaitingAccept}
          </span>
        )}
        {view.defect > 0 && (
          <span className={`${styles.chip} ${styles.chipBlocked}`}>
            брак: {view.defect}
          </span>
        )}
        {view.lost > 0 && (
          <span className={`${styles.chip} ${styles.chipBlocked}`}>
            не вернулось: {view.lost}
          </span>
        )}
      </div>

      <div className={styles.subText}>
        Следующий этап:{' '}
        <strong>{next ? stageLabel(next, deptName(next.department_id)) : 'приёмка на складе Pinhead'}</strong>
        {next && ` · ${STAGE_STATUS_LABELS[next.status]}`}
      </div>

      {/* Дополнительная информация — ниже, свёрнута, визуально слабее */}
      <details className={styles.gridDetails}>
        <summary className={styles.subText}>ТЗ и файлы для подрядчика</summary>
        <StageFilesBlock op={sub} order={order} itemId={item.id} canManage={canManage} />
      </details>

      <details className={styles.gridDetails}>
        <summary className={styles.subText}>Переданные материалы</summary>
        <MaterialsBlock op={sub} canManage={canManage} />
      </details>

      <details className={styles.gridDetails}>
        <summary className={styles.subText}>
          Стоимость{sub?.cost != null ? ` — ${sub.cost} ₽` : ''}
        </summary>
        <CostBlock op={sub} canManage={canManage} />
      </details>

      <details className={styles.gridDetails}>
        <summary className={styles.subText}>Подробности передачи и возврата</summary>
        <HandoffBlock op={sub} />
      </details>

      <details className={styles.gridDetails}>
        <summary className={styles.subText}>Маршрут позиции</summary>
        <RouteProgress
          item={item}
          order={order}
          deptById={deptById}
          currentStageId={stage.id}
        />
      </details>

      <details className={styles.gridDetails}>
        <summary className={styles.subText}>
          История перемещений{(sub?.moves ?? []).length > 0 ? ` — ${sub.moves.length}` : ''}
        </summary>
        <MoveJournal op={sub} />
      </details>
    </div>
  );
}
