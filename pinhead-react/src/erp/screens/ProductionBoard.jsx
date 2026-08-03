import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { KanbanSkeleton, TableSkeleton } from '../components/ErpSkeletons';
import { LoadFailed } from '../components/ErpStates';
import { QueueFilters } from '../components/QueueFilters';
import ErpKanban from '../components/ErpKanban';
import { Icon } from '../components/Icon';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { orderLinkClick } from '../store/useOrderDrawer';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { isStageReady, waitingReason, materialsForItem } from '../utils/routes';
import { stageMissingTz } from '../utils/tz';
import {
  applyStageFilters, EMPTY_FILTERS, filtersFromParams, filtersToParams, hasActiveFilters,
} from '../utils/filterStages';
import { buildQueueEntries } from '../utils/queueEntries';
import { confirmStageDone } from '../utils/stageDone';
import { isProductionDept, deptShortName } from '../data/departments';
import { daysLeft, formatDateShort } from '../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip } from '../utils/stageUi';
import { itemProgress } from '../utils/progress';
import { pluralize } from '../../utils/i18n';
import { useCompactLayout } from '../layout/useCompactLayout';
import { BoardCardMobile } from './board/BoardCardMobile';
import { STAGE_STATUS_LABELS } from '../types';
import styles from '../erp.module.css';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { dueLabelCompact } from '../utils/format';
import { Button } from '../components/Button';

/**
 * Производственный план — мастер-таблица (аналог 1_Производственный_план).
 * Строка = позиция заказа, колонки = этапы-светофор по цехам.
 * Клик по этапу циклит статус: ready → in_progress → done.
 *
 * Фильтры — те же, что в очереди цеха и на канбане (`applyStageFilters`): строка
 * показывается, если под подбор попал хотя бы один её этап. Раньше таблица брала
 * из фильтров только строку поиска, а «Просрочено» / «С проблемой» / цех / статус
 * красились активными и ничего не меняли — диспетчер делал вывод, что просрочено всё.
 */

/** Следующий статус по клику (простая механика MVP) */
const NEXT_STATUS = {
  ready: 'in_progress',
  in_progress: 'done',
};

/** Право, которое нужно для клика по чипу этапа */
const NEXT_PERMISSION = {
  ready: 'stage.take',
  in_progress: 'stage.complete',
};

function StageChip({ stage, item, order, deptById, onAdvance, allowAdvance }) {
  const dept = deptById.get(stage.department_id);
  const allStages = item.stages;

  // waiting в БД, но зависимости выполнены → показываем как «готов к работе»
  const noTz = stageMissingTz(order, item.id, dept);
  const effectiveReady =
    stage.status === 'waiting' &&
    isStageReady(stage, allStages, materialsForItem(order.materials, item.id), dept, false, noTz);
  const displayStatus = effectiveReady ? 'ready' : stage.status;

  const reason =
    displayStatus === 'waiting' || displayStatus === 'blocked'
      ? waitingReason(
          stage, allStages, materialsForItem(order.materials, item.id),
          new Map([...deptById].map(([id, d]) => [id, d.name])),
          dept, false, noTz,
        )
      : null;

  // Двигать этап может только тот, кому это разрешено матрицей прав и кто работает
  // в этом цехе. Раньше чип двигал статус любому, кто открыл экран, — доска была
  // единственным местом действий в обход useErpAccess.
  const advanceable = displayStatus === 'ready' || displayStatus === 'in_progress';
  const clickable = advanceable && allowAdvance(stage.department_id, displayStatus);
  const title = [
    dept?.name,
    STAGE_STATUS_LABELS[displayStatus],
    reason,
    clickable ? `Клик: ${STAGE_STATUS_LABELS[NEXT_STATUS[displayStatus]]}` : null,
    advanceable && !clickable ? 'Нет прав менять статус этого этапа' : null,
  ].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.chipBtn} ${styles[STAGE_CHIP_CLASS[displayStatus]]}`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      title={title}
      aria-label={title}
      disabled={!clickable}
      onClick={() => clickable && onAdvance(stage, NEXT_STATUS[displayStatus], item)}
    >
      {dept ? deptShortName(dept.code, dept.name) : '?'}
      {displayStatus === 'done' && <Icon name="check" size={12} />}
    </button>
  );
}

export default function ProductionBoard() {
  const {
    orders, departments, loading, loaded, loadError, loadAll, setStageStatus,
    archiveLoaded, loadArchive,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      setStageStatus: s.setStageStatus,
      archiveLoaded: s.archiveLoaded,
      loadArchive: s.loadArchive,
    })),
  );
  const access = useErpAccess();
  const isCompact = useCompactLayout();
  const [onlyActive, setOnlyActive] = useState(true);
  const [view, setView] = useState(() => localStorage.getItem('erp_board_view') || 'table');
  const switchView = (v) => { setView(v); localStorage.setItem('erp_board_view', v); };

  // Поиск, фильтры и сортировка — общие с очередью цеха, состояние в URL (правки 4 и 9)
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next) => setSearchParams(filtersToParams(next), { replace: true }),
    [setSearchParams],
  );
  useScrollRestore(loaded);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  // Снят фильтр «Только активные» → нужны и архивные (лениво)
  useEffect(() => {
    if (!onlyActive && !archiveLoaded) loadArchive();
  }, [onlyActive, archiveLoaded, loadArchive]);

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  /** Цеха с очередью — колонки канбана и значения фильтра «Цех» */
  const queueDepartments = useMemo(
    () => departments.filter((d) => d.active && isProductionDept(d)),
    [departments],
  );
  const assignees = useMemo(
    () => [...new Set(
      orders.flatMap((o) => o.items).flatMap((it) => it.stages).map((s) => s.assignee).filter(Boolean),
    )].sort(),
    [orders],
  );

  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );

  /** Задания всех заказов — тот же источник, что у очереди и канбана */
  const entries = useMemo(
    () => buildQueueEntries(orders, departments, { includeInactive: !onlyActive }),
    [orders, departments, onlyActive],
  );

  /**
   * Строка = позиция заказа. Позиция видна, если под фильтры попал хотя бы один
   * её этап; порядок строк — по лучшему (первому в отсортированном списке) этапу,
   * поэтому сортировка «по приоритету / сроку / величине просрочки» работает и здесь.
   */
  const rows = useMemo(() => {
    const byItem = new Map();
    for (const e of applyStageFilters(entries, filters)) {
      if (!byItem.has(e.item.id)) byItem.set(e.item.id, { order: e.order, item: e.item });
    }
    return [...byItem.values()];
  }, [entries, filters]);

  const filtersActive = hasActiveFilters(filters);

  /** Может ли текущий пользователь двинуть этап этого цеха дальше */
  const allowAdvance = useCallback(
    (departmentId, displayStatus) =>
      access.canDo(NEXT_PERMISSION[displayStatus], departmentId),
    [access],
  );

  /** Чип этапа — общий для таблицы и мобильной карточки */
  const renderStage = (st, order, item) => (
    <StageChip
      key={st.id}
      stage={st}
      item={item}
      order={order}
      deptById={deptById}
      onAdvance={onAdvance}
      allowAdvance={allowAdvance}
    />
  );

  const onAdvance = async (stage, nextStatus, item) => {
    if (nextStatus !== 'done') {
      await setStageStatus(stage.id, nextStatus);
      return;
    }
    // Чип пишет весь тираж — при незакрытом остатке спрашиваем, как в очереди цеха
    const ok = await confirmStageDone({
      stage, qty: item.qty, allStages: item.stages, deptNameById,
    });
    if (!ok) return;
    await setStageStatus(stage.id, 'done', { qty_done: item.qty });
  };

  return (
    <>
      <PageHead
        title="Производственный план"
        sub="Все позиции в работе: этапы-светофор по цехам, сроки, узкие места."
      />

      <div className={styles.toolbar}>
        {/* Не tablist: панели с role="tabpanel" нет, aria-controls нет, стрелочной
            навигации нет — объявлять паттерн вкладок наполовину хуже, чем не
            объявлять. Это переключатель, и aria-pressed описывает его честно. */}
        <div role="group" aria-label="Вид" style={{ display: 'flex', gap: 6 }}>
          <button
            type="button" aria-pressed={view === 'table'}
            className={`${styles.chip} ${styles.chipBtn} ${view === 'table' ? styles.chipProgress : styles.chipNeutral}`}
                        onClick={() => switchView('table')}
          >
            <Icon name="queue" size={13} /> Таблица
          </button>
          <button
            type="button" aria-pressed={view === 'kanban'}
            className={`${styles.chip} ${styles.chipBtn} ${view === 'kanban' ? styles.chipProgress : styles.chipNeutral}`}
                        onClick={() => switchView('kanban')}
          >
            <Icon name="board" size={13} /> Канбан
          </button>
        </div>
        {view === 'table' && (
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            Только активные
          </label>
        )}
        <div className={styles.spacer} />
        {/* Счётчик считает строки таблицы: на канбане набор другой (только
            производственные цеха, «Завершено» обрезано), и то же число врало бы */}
        {view === 'table' && (
          <span className={styles.subText}>
            {rows.length} {pluralize(rows.length, 'позиция', 'позиции', 'позиций')}
          </span>
        )}
      </div>

      <QueueFilters
        filters={filters}
        onChange={setFilters}
        departments={queueDepartments}
        assignees={assignees}
      />

      {view === 'kanban' && loaded && <ErpKanban filters={filters} />}
      {/* Заглушка была привязана к табличному виду: на канбане при пустом подборе
          или без заведённых участков оставалась просто пустая область */}
      {view === 'kanban' && loaded && rows.length === 0 && (
        <div className={styles.emptyState}>
          {filtersActive ? (
            <>
              Под фильтры ничего не попало.{' '}
              <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                Сбросить фильтры
              </Button>
            </>
          ) : queueDepartments.length === 0 ? (
            <>Производственные участки не заведены — добавьте их в админке.</>
          ) : (
            'Нет позиций в работе. Создайте заказ на экране «Заказы».'
          )}
        </div>
      )}

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="производственный план" />}
      {/* Скелетон по виду: в канбан-виде появится доска, а не таблица */}
      {!loadError && loading && !loaded && (
        view === 'kanban'
          ? <KanbanSkeleton />
          : <TableSkeleton rows={6} label="Загрузка производственного плана" />
      )}

      {view === 'table' && loaded && rows.length === 0 && (
        <div className={styles.emptyState}>
          {filtersActive ? (
            <>
              Под фильтры ничего не попало.{' '}
              <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                Сбросить фильтры
              </Button>
            </>
          ) : (
            'Нет позиций в работе. Создайте заказ на экране «Заказы».'
          )}
        </div>
      )}

      {/* На 390px таблица показывала только «№ / Заказ / Кол-во» — срок, прогресс
          и этапы уезжали за край без подсказки прокрутки. Ниже 760px — карточки. */}
      {view === 'table' && rows.length > 0 && isCompact && (
        <div className={styles.queueGrid}>
          {rows.map(({ order, item }) => (
            <BoardCardMobile
              key={item.id}
              order={order}
              item={item}
              renderStage={(st) => renderStage(st, order, item)}
            />
          ))}
        </div>
      )}

      {view === 'table' && rows.length > 0 && !isCompact && (
        <ScrollHintBox className={styles.tableWrap} label="Производственный план">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№</th>
                <th>Заказ / позиция</th>
                <th>Кол-во</th>
                <th>Срок</th>
                <th>Прогресс</th>
                <th>Этапы</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order, item }) => {
                const d = daysLeft(order.due_date);
                const dueCls = d !== null && d < 0
                  ? styles.overdue
                  : d !== null && d <= 3 ? styles.dueSoon : undefined;
                const progress = itemProgress(item);
                return (
                  <tr key={item.id}>
                    {/* Номер и название — ссылки: раньше это был обычный текст,
                        и увиденную на доске проблемную позицию нельзя было открыть */}
                    <td>
                      <Link
                        to={`/orders/${order.id}`}
                        onClick={(e) => orderLinkClick(order.id, e)}
                        title={`Открыть заказ №${order.bitrix_id || '—'}`}
                      >
                        {order.bitrix_id || '—'}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/orders/${order.id}`}
                        onClick={(e) => orderLinkClick(order.id, e)}
                        className={styles.cellTitle}
                        title={order.title}
                      >
                        {order.title}
                      </Link>
                      {isOrderReadyToShip(order) && (
                        <span
                          className={`${styles.chip} ${styles.chipReady}`}
                          style={{ marginLeft: 6 }}
                          title="Все этапы завершены — заказ готов к отгрузке"
                        >
                          <Icon name="checkCircle" size={13} /> к отгрузке
                        </span>
                      )}
                      <div className={styles.subText}>
                        {item.product_type}
                        {item.variant ? ` · ${item.variant}` : ''}
                        {order.manager ? ` · ${order.manager}` : ''}
                      </div>
                    </td>
                    <td>{item.qty}</td>
                    <td>
                      {/* Класс висел на <td>, а число дней лежит в .subText со своим
                          color — дата краснела, «просрочен 5» оставался серым.
                          Красим сам текст, как в строке очереди */}
                      <div className={dueCls}>
                        {order.due_date ? formatDateShort(order.due_date) : '—'}
                      </div>
                      {d !== null && (
                        <div className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
                          {dueLabelCompact(d)}
                        </div>
                      )}
                    </td>
                    <td className={styles.progressCell}>
                      <div className={styles.progressLine} title={`Сделано ${progress.done} из ${progress.total} шт по этапам маршрута`}>
                        <div className={styles.progressTrack} aria-hidden="true">
                          <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
                        </div>
                        <span>{progress.pct}%</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.stageChips}>
                        {item.stages.map((st) => renderStage(st, order, item))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </>
  );
}
