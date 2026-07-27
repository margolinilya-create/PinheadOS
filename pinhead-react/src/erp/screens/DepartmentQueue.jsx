import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { QueueSkeleton } from '../components/ErpSkeletons';
import { QueueFilters } from '../components/QueueFilters';
import { useErpStore, readyOnlyCountFor, overdueUnackCountFor } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { useAuthStore } from '../../store/useAuthStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useScrollHints } from '../../hooks/useScrollHints';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { buildQueueEntries } from '../utils/queueEntries';
import { applyStageFilters, filtersFromParams, filtersToParams } from '../utils/filterStages';
import { deptShortName, isQueueDept } from '../data/departments';
import styles from '../erp.module.css';
import { QueueCard } from './queue/QueueCard';
import { QueueRow } from './queue/QueueRow';
import { useStageActions } from './queue/useStageActions';

/**
 * Экран цеха: рабочая очередь конкретного участка.
 *
 * Три блока по требованию (правка 2): «В работе» → «Готово к запуску» → «Ожидает»
 * (с конкретной причиной; ручные блокировки попадают сюда же со своей причиной).
 * «Завершено недавно» остаётся четвёртым и по умолчанию свёрнуто.
 *
 * Очередь компактная — строка вместо крупной карточки (QueueRow); на телефоне
 * (<760px) остаётся карточка. Порядок строк = приоритет (queue_position);
 * перетаскивание меняет приоритет и сохраняется сразу для всех (правка 3).
 *
 * Выбранный цех живёт в маршруте (/queue/:deptCode), фильтры — в URL: возврат
 * из карточки заказа восстанавливает и цех, и подбор, и позицию прокрутки (правка 6).
 */

/** Заголовки блоков очереди (порядок = порядок отображения из требования) */
const GROUP_TITLES = {
  in_progress: '🟡 В работе',
  ready: '🟢 Готово к запуску',
  waiting: '⏳ Ожидает',
  done: '✓ Завершено недавно',
};

export default function DepartmentQueue() {
  const {
    orders, departments, loading, loaded, loadAll,
    myDeptId, myDeptLoaded, loadMyDept,
    loadStageReworkEvents, reorderStageQueue,
    employees, employeesLoaded, loadEmployees,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      myDeptId: s.myDeptId,
      myDeptLoaded: s.myDeptLoaded,
      loadMyDept: s.loadMyDept,
      loadStageReworkEvents: s.loadStageReworkEvents,
      reorderStageQueue: s.reorderStageQueue,
      employees: s.employees,
      employeesLoaded: s.employeesLoaded,
      loadEmployees: s.loadEmployees,
    })),
  );
  const actions = useStageActions();
  const access = useErpAccess();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { deptCode: routeDept } = useParams();
  const isMobile = useMediaQuery('(max-width: 760px)');

  // Возвраты брака по этапам текущего цеха — для баннера получателю (п.10)
  const [reworkByStage, setReworkByStage] = useState({});
  const [showDone, setShowDone] = useState(false);
  const [drag, setDrag] = useState(null);   // перетаскиваемая строка
  const [dropAt, setDropAt] = useState(null); // { id, before } — куда встанет

  // Фильтры и сортировка живут в URL (правки 6 и 9)
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next) => setSearchParams(filtersToParams(next), { replace: true }),
    [setSearchParams],
  );

  // Вкладки цехов: градиенты-подсказки скрытого контента + автопрокрутка активной
  const { ref: tabsRef, hints: tabHints } = useScrollHints();
  useScrollRestore(loaded);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  useEffect(() => {
    if (!myDeptLoaded) loadMyDept(user?.id);
  }, [myDeptLoaded, loadMyDept, user?.id]);

  // Имя руководителя участка (правка 11) — сотрудники грузятся лениво
  useEffect(() => {
    if (!employeesLoaded) loadEmployees();
  }, [employeesLoaded, loadEmployees]);

  /** Цех из привязки erp_employees (автопривязка, п.10) */
  const boundDept = useMemo(
    () => departments.find((dd) => dd.id === myDeptId) || null,
    [departments, myDeptId],
  );

  // Цех берём из маршрута; /queue без кода — привязанный цех, иначе последний выбранный
  const deptCode = routeDept || boundDept?.code || localStorage.getItem('erp_my_dept') || '';
  const selectDept = (code) => {
    localStorage.setItem('erp_my_dept', code);
    navigate(`/queue/${code}`);
  };

  // Канонизируем адрес: на /queue подставляем код цеха, чтобы меню слева подсветило участок
  useEffect(() => {
    if (!routeDept && deptCode) navigate(`/queue/${deptCode}`, { replace: true });
  }, [routeDept, deptCode, navigate]);

  // Активная вкладка цеха — всегда в видимой области скролла
  useEffect(() => {
    if (!deptCode) return;
    const el = tabsRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [deptCode, tabsRef]);

  const dept = departments.find((dd) => dd.code === deptCode) || null;
  const deptHead = useMemo(
    () => (dept?.head_employee_id
      ? employees.find((e) => e.id === dept.head_employee_id)?.full_name ?? null
      : null),
    [dept, employees],
  );
  const deptShortById = useMemo(
    () => new Map(departments.map((dd) => [dd.id, deptShortName(dd.code, dd.name)])),
    [departments],
  );

  // Привязки нет и нет legacy-выбора (localStorage) → заглушка для рядовых ролей
  const showStub = !access.isPrivileged && myDeptLoaded && !boundDept && !deptCode;
  // Действия разрешены: рук. состав всюду; при привязке — только в своём цехе
  const canAct = access.canActIn(dept?.id);
  // Приоритет меняет тот, кому это разрешено матрицей ролей, и только в своём цехе
  const canReorder = access.canDo('stage.priority', dept?.id);

  /** Счётчик «готово к работе» (только ready) по каждому цеху — для бейджей на вкладках (ERP-06) */
  const readyByDept = useMemo(() => {
    const counts = new Map();
    for (const dd of departments) {
      counts.set(dd.code, readyOnlyCountFor(orders, departments, dd.code));
    }
    return counts;
  }, [orders, departments]);

  const overdueByDept = useMemo(() => {
    const counts = new Map();
    for (const dd of departments) {
      counts.set(dd.code, overdueUnackCountFor(orders, departments, dd.code));
    }
    return counts;
  }, [orders, departments]);

  /** Все задания цеха с группой и причиной ожидания — до фильтров */
  const entries = useMemo(
    () => (dept ? buildQueueEntries(orders, departments, { departmentId: dept.id }) : []),
    [orders, departments, dept],
  );

  const visible = useMemo(
    () => applyStageFilters(entries, filters),
    [entries, filters],
  );

  /** Три блока требования + свёрнутое «Завершено недавно» */
  const groups = useMemo(() => {
    const g = { in_progress: [], ready: [], waiting: [], done: [] };
    for (const e of visible) {
      if (e.group === 'done') g.done.push(e);
      else if (e.group === 'in_progress') g.in_progress.push(e);
      else if (e.group === 'ready') g.ready.push(e);
      else g.waiting.push(e); // waiting + blocked: «Ожидает» с конкретной причиной
    }
    g.done = g.done
      .slice()
      .sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''))
      .slice(0, 10);
    return g;
  }, [visible]);

  /** Исполнители, встречающиеся в очереди — для фильтра */
  const assignees = useMemo(
    () => [...new Set(entries.map((e) => e.stage.assignee).filter(Boolean))].sort(),
    [entries],
  );

  // Подтягиваем причины возврата брака для этапов с qty_rework (баннер получателю)
  useEffect(() => {
    const ids = visible
      .filter((e) => (e.stage.qty_rework ?? 0) > 0)
      .map((e) => e.stage.id);
    let alive = true;
    // loadStageReworkEvents([]) сразу резолвится в {} — setState только в async-колбэке
    loadStageReworkEvents(ids).then((map) => { if (alive) setReworkByStage(map); });
    return () => { alive = false; };
  }, [visible, loadStageReworkEvents]);

  // --- Перетаскивание строк = приоритет (правка 3) ---------------------------
  const dragRef = useRef(null);
  const onDragStart = (e, entry) => {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', entry.stage.id); } catch { /* IE */ }
    dragRef.current = entry;
    setDrag(entry);
  };
  const onDragEnd = () => { dragRef.current = null; setDrag(null); setDropAt(null); };
  const onDragOverRow = (e, entry) => {
    const dragged = dragRef.current;
    if (!dragged || dragged.stage.id === entry.stage.id) return;
    // Приоритет имеет смысл только внутри одного блока очереди
    if (dragged.group !== entry.group) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropAt({ id: entry.stage.id, before: e.clientY < rect.top + rect.height / 2 });
  };
  const onDrop = async (list) => {
    const dragged = dragRef.current;
    const target = dropAt;
    onDragEnd();
    if (!dragged || !target) return;
    const ids = list.map((e) => e.stage.id).filter((id) => id !== dragged.stage.id);
    const at = ids.indexOf(target.id);
    if (at < 0) return;
    const insertAt = target.before ? at : at + 1;
    await reorderStageQueue(
      dragged.stage.id,
      insertAt > 0 ? ids[insertAt - 1] : null,
      insertAt < ids.length ? ids[insertAt] : null,
    );
  };

  if (showStub) {
    return (
      <>
        <PageHead
          title="Мой цех"
          sub="Очередь работ цеха: бери в работу, отмечай готово, сообщай о проблемах."
        />
        <div className={styles.emptyState}>
          Ваш профиль не привязан к цеху — обратитесь к администратору.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title={dept ? dept.name : 'Мой цех'}
        sub={[
          'Очередь работ цеха: бери в работу, вноси результат, сообщай о проблемах.',
          // Руководитель участка закрепляется в админке (правка 11)
          deptHead ? `Руководитель: ${deptHead}.` : null,
        ].filter(Boolean).join(' ')}
      />

      <div className={styles.deptTabsWrap}>
        <div className={styles.deptTabs} role="tablist" aria-label="Выбор цеха" ref={tabsRef}>
          {departments.filter((dd) => dd.active && isQueueDept(dd.code)).map((dd) => {
            const count = readyByDept.get(dd.code) || 0;
            const overdueCount = overdueByDept.get(dd.code) || 0;
            const isMine = boundDept?.code === dd.code;
            return (
              <button
                key={dd.code}
                type="button"
                role="tab"
                aria-selected={deptCode === dd.code}
                className={`${styles.deptTab} ${deptCode === dd.code ? styles.deptTabActive : ''}`}
                onClick={() => selectDept(dd.code)}
              >
                {deptShortName(dd.code, dd.name)}
                {isMine && <span aria-label="ваш цех" title="Ваш цех">★</span>}
                {count > 0 && (
                  <span className={`${styles.deptTabCount} ${styles.deptTabHot}`}>{count}</span>
                )}
                {overdueCount > 0 && (
                  <span className={styles.deptTabCount} style={{ background: 'var(--color-error)' }} title="Необработанные просрочки">
                    ⏰{overdueCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {tabHints.left && <div className={`${styles.deptTabsFade} ${styles.deptTabsFadeL}`} aria-hidden="true" />}
        {tabHints.right && <div className={`${styles.deptTabsFade} ${styles.deptTabsFadeR}`} aria-hidden="true" />}
      </div>

      {dept && loaded && (
        <QueueFilters
          filters={filters}
          onChange={setFilters}
          assignees={assignees}
          showDept={false}
          right={<span className={styles.subText}>{visible.length} заданий</span>}
        />
      )}

      {!dept && <div className={styles.emptyState}>Выберите свой цех выше — выбор запомнится.</div>}
      {dept && loading && !loaded && <QueueSkeleton />}

      {dept && !canAct && (
        <div className={styles.queueReason} style={{ marginBottom: 'var(--space-md, 14px)' }}>
          👁 Это не ваш цех — только просмотр. Ваш цех: {boundDept ? deptShortName(boundDept.code, boundDept.name) : '—'}.
        </div>
      )}

      {dept && loaded && Object.entries(GROUP_TITLES).map(([key, title]) => {
        const list = groups[key];
        if (!list || list.length === 0) return null;
        const collapsed = key === 'done' && !showDone;
        return (
          <section key={key} style={{ marginBottom: 'var(--space-lg, 20px)' }}>
            <h2 className={styles.queueGroupTitle}>
              {title} <span className={styles.subText}>({list.length})</span>
              {key === 'done' && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-expanded={showDone}
                  onClick={() => setShowDone((v) => !v)}
                >
                  {showDone ? 'Свернуть' : 'Показать'}
                </button>
              )}
            </h2>
            {!collapsed && (isMobile ? (
              <div className={styles.queueGrid}>
                {list.map((entry) => (
                  <QueueCard
                    key={entry.stage.id}
                    entry={entry}
                    canAct={canAct}
                    rework={reworkByStage[entry.stage.id] || null}
                    deptShortById={deptShortById}
                    actions={actions}
                  />
                ))}
              </div>
            ) : (
              <div
                className={styles.queueList}
                onDrop={() => onDrop(list)}
                onDragOver={(e) => { if (drag) e.preventDefault(); }}
              >
                {list.map((entry, i) => (
                  <QueueRow
                    key={entry.stage.id}
                    entry={entry}
                    index={i}
                    canAct={canAct}
                    canReorder={canReorder && entry.group !== 'done'}
                    rework={reworkByStage[entry.stage.id] || null}
                    deptShortById={deptShortById}
                    actions={actions}
                    dragging={drag?.stage.id === entry.stage.id}
                    dropBefore={dropAt?.id === entry.stage.id && dropAt.before}
                    dropAfter={dropAt?.id === entry.stage.id && !dropAt.before}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDragOverRow={onDragOverRow}
                  />
                ))}
              </div>
            ))}
          </section>
        );
      })}

      {dept && loaded && visible.length === 0 && (
        <div className={styles.emptyState}>
          {entries.length === 0
            ? 'В этом цехе пока нет работ.'
            : 'Под фильтры ничего не подошло — сбросьте их выше.'}
        </div>
      )}
    </>
  );
}
