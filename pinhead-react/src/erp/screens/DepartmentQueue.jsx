import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { QueueSkeleton } from '../components/ErpSkeletons';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { QueueFilters } from '../components/QueueFilters';
import { useErpStore, readyOnlyCountFor, overdueUnackCountFor } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { useStagePermissions } from '../store/useStagePermissions';
import { useTouchDndPolyfill } from '../components/kanban/useTouchDndPolyfill';
import { useAuthStore } from '../../store/useAuthStore';
import { useCompactLayout } from '../layout/useCompactLayout';
import { useScrollHints } from '../../hooks/useScrollHints';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { buildQueueEntries } from '../utils/queueEntries';
import { applyStageFilters, filtersFromParams, filtersToParams } from '../utils/filterStages';
import { deptShortName, isProductionDept } from '../data/departments';
import { pluralize } from '../../utils/i18n';
import { onTabListKeyDown } from '../utils/tabs';
import styles from '../erp.module.css';
import { Icon } from '../components/Icon';
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

/**
 * Заголовки блоков очереди (порядок = порядок отображения из требования).
 * «Ожидают материалы» отделены от общего «Ожидает» правкой менеджера 2026-08-03:
 * «ждём ткань» и «швейка ещё не сдала» требуют разных решений, и в общей куче
 * понять, что цех стоит из-за снабжения, было нельзя.
 */
const GROUP_TITLES = {
  in_progress: 'В работе',
  awaiting_materials: (
    <span className={styles.cellWithIcon}><Icon name="box" size={16} />Ожидают материалы</span>
  ),
  ready: 'Готово к запуску',
  waiting: (
    <span className={styles.cellWithIcon}><Icon name="clock" size={16} />Ожидает</span>
  ),
  done: (
    <span className={styles.cellWithIcon}><Icon name="check" size={16} />Завершено недавно</span>
  ),
};

export default function DepartmentQueue() {
  const {
    orders, departments, loaded, loadError, loadAll,
    myDeptId, myDeptLoaded, loadMyDept,
    loadStageReworkEvents, reorderStageQueue,
    employees, employeesLoaded, loadEmployees,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
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
  const isCompact = useCompactLayout();

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
  // Ручка приоритета в строке — HTML5 DnD, который на touch не срабатывает вовсе.
  // Подсказка «Перетащите, чтобы изменить приоритет» при этом показывалась, и на
  // планшете бригадир тянул строку впустую. Полифилл ленивый и no-op на десктопе.
  useTouchDndPolyfill();
  // Каждое действие цеха гейтится своим правом матрицы (взять / записать / завершить /
  // проблема / брак), а не одним «мой ли это цех» — см. useStagePermissions
  const perms = useStagePermissions(dept?.id);
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
    const g = { in_progress: [], awaiting_materials: [], ready: [], waiting: [], done: [] };
    for (const e of visible) {
      if (e.group === 'done') g.done.push(e);
      else if (e.group === 'in_progress') g.in_progress.push(e);
      else if (e.group === 'awaiting_materials') g.awaiting_materials.push(e);
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
  /**
   * Приоритет с клавиатуры — единственная альтернатива перетаскиванию (WCAG 2.1.1).
   * До этого `reorderStageQueue` был доступен только мышью: ни `tabIndex`, ни
   * обработчиков клавиш во всей зоне не было. Кнопки заодно решают проблему
   * планшета — по ним можно просто нажать.
   */
  const moveInQueue = async (list, entry, dir) => {
    const ids = list.map((e) => e.stage.id);
    const from = ids.indexOf(entry.stage.id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const without = ids.filter((id) => id !== entry.stage.id);
    await reorderStageQueue(
      entry.stage.id,
      to > 0 ? without[to - 1] : null,
      to < without.length ? without[to] : null,
    );
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
        <div className={styles.deptTabs} role="tablist" aria-label="Выбор цеха" ref={tabsRef} onKeyDown={onTabListKeyDown}>
          {departments.filter((dd) => dd.active && isProductionDept(dd)).map((dd) => {
            const count = readyByDept.get(dd.code) || 0;
            const overdueCount = overdueByDept.get(dd.code) || 0;
            const isMine = boundDept?.code === dd.code;
            return (
              <button
                key={dd.code}
                type="button"
                role="tab"
                id={`queue-tab-${dd.code}`}
                aria-controls="queue-tabpanel"
                aria-selected={deptCode === dd.code}
                tabIndex={deptCode === dd.code ? 0 : -1}
                className={`${styles.deptTab} ${deptCode === dd.code ? styles.deptTabActive : ''}`}
                onClick={() => selectDept(dd.code)}
              >
                {deptShortName(dd.code, dd.name)}
                {isMine && <Icon name="star" size={13} title="Ваш цех" />}
                {count > 0 && (
                  <span
                    className={`${styles.deptTabCount} ${styles.deptTabHot}`}
                    aria-label={`готово к работе: ${count}`}
                  >
                    {count}
                  </span>
                )}
                {overdueCount > 0 && (
                  // Класс, а не инлайн-фон: инлайн менял только заливку, текст
                  // оставался серым (--text-mid на красном ≈ 2:1) — и самый срочный
                  // сигнал экрана читался хуже всего
                  <span
                    className={`${styles.deptTabCount} ${styles.deptTabOverdue}`}
                    title="Необработанные просрочки"
                    aria-label={`просрочено: ${overdueCount}`}
                  >
                    <span className={styles.cellWithIcon}>
                      <Icon name="clock" size={12} />{overdueCount}
                    </span>
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
          right={(
            <span className={styles.subText}>
              {visible.length} {pluralize(visible.length, 'задание', 'задания', 'заданий')}
            </span>
          )}
        />
      )}

      {/* Порядок важен: пока не загрузились — скелетон, а не «выберите цех».
          Прежнее условие `dept && loading && !loaded` было невыполнимо в принципе
          (departments и loaded: true пишутся одним set), поэтому цех при загрузке
          и при обрыве связи читал «Выберите свой цех» и решал, что заданий нет. */}
      <div
        id="queue-tabpanel"
        role="tabpanel"
        aria-labelledby={deptCode ? `queue-tab-${deptCode}` : undefined}
        tabIndex={-1}
      >
      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="задания цеха" />}
      {!loadError && !loaded && <QueueSkeleton />}
      {loaded && !dept && (
        <div className={styles.emptyState}>Выберите свой цех выше — выбор запомнится.</div>
      )}

      {dept && !perms.inDept && (
        <div className={styles.queueReason} style={{ marginBottom: 'var(--space-md, 14px)' }}>
          <Icon name="eye" size={14} /> Это не ваш цех — только просмотр. Ваш цех: {boundDept ? deptShortName(boundDept.code, boundDept.name) : '—'}.
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
            {!collapsed && (isCompact ? (
              <div className={styles.queueGrid}>
                {list.map((entry) => (
                  <QueueCard
                    key={entry.stage.id}
                    entry={entry}
                    perms={perms}
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
                    perms={perms}
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
                    canMoveUp={i > 0}
                    canMoveDown={i < list.length - 1}
                    onMove={(dir) => moveInQueue(list, entry, dir)}
                  />
                ))}
              </div>
            ))}
          </section>
        );
      })}

      {dept && loaded && visible.length === 0 && (
        entries.length === 0 ? (
          <EmptyState
            icon="check"
            title="В этом цехе пока нет работ"
            text="Новые задания появятся здесь, как только предыдущий этап будет сдан."
          />
        ) : (
          /* Кнопка «Сбросить» обязательна: фильтры живут в URL и переживают
             перезагрузку. Рабочий, случайно оставивший «просрочено», видел
             «под фильтры ничего не подошло», читал это как «работы нет» и уходил —
             а сбросить их предлагалось «выше», где он их уже не искал. */
          <EmptyResult onReset={() => setFilters({})} resetLabel="Сбросить фильтры">
            Под фильтры ничего не подошло. В цехе есть работы: {entries.length}.
          </EmptyResult>
        )
      )}
      </div>
    </>
  );
}
