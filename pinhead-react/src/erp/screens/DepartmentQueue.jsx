import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { QueueSkeleton } from '../components/ErpSkeletons';
import { SearchInput } from '../components/SearchInput';
import { useErpStore, readyCountFor, overdueUnackCountFor } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useScrollHints } from '../../hooks/useScrollHints';
import { toast } from '../../store/useToastStore';
import { isStageReady, waitingReason, isStageAwaitingProcurement } from '../utils/routes';
import { stageOverdue } from '../utils/time';
import { matchesOrderQuery } from '../utils/orderSearch';
import { deptShortName, isQueueDept } from '../data/departments';
import styles from '../erp.module.css';
import { QueueCard } from './queue/QueueCard';

/**
 * Экран цеха: очередь работ конкретного цеха.
 * Группы: Готов к работе → В работе → Ожидает (с причиной) → Готово.
 * Крупные кнопки — цех работает с планшета/телефона.
 * Цех пользователя определяется по erp_employees.profile_id (автопривязка);
 * чужие цеха — только просмотр (кроме admin/director/rop).
 */

/** Роли с полным доступом ко всем цехам */
const FULL_ACCESS_ROLES = ['admin', 'director', 'rop'];

/** Заголовки групп очереди (порядок = порядок отображения) */
const GROUP_TITLES = {
  ready: '🟢 Готово к работе',
  in_progress: '🟡 В работе',
  waiting: '⏳ Ожидает',
  blocked: '🚫 Заблокировано',
  done: '✓ Завершено недавно',
};

export default function DepartmentQueue() {
  const {
    orders, departments, loading, loaded, loadAll,
    myDeptId, myDeptLoaded, loadMyDept,
    setStageStatus, setStagePlan, reportProgress, reportDefect, uploadOrderAttachment,
    loadStageReworkEvents, ackStageOverdue,
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
      setStageStatus: s.setStageStatus,
      setStagePlan: s.setStagePlan,
      reportProgress: s.reportProgress,
      reportDefect: s.reportDefect,
      uploadOrderAttachment: s.uploadOrderAttachment,
      loadStageReworkEvents: s.loadStageReworkEvents,
      ackStageOverdue: s.ackStageOverdue,
    })),
  );
  // Возвраты брака по этапам текущего цеха — для баннера получателю (п.10)
  const [reworkByStage, setReworkByStage] = useState({});
  const [query, setQuery] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const user = useAuthStore((s) => s.user);
  // Ручной выбор вкладки: legacy localStorage — начальное значение
  const [pickedDept, setPickedDept] = useState(() => localStorage.getItem('erp_my_dept') || '');
  // Выбирал ли пользователь вкладку в этой сессии (иначе действует автопривязка)
  const [sessionPick, setSessionPick] = useState(false);

  // dev-режим — свободный выбор, роли рук. состава — полный доступ
  const privileged = user?.id === 'dev' || FULL_ACCESS_ROLES.includes(user?.role);

  // Вкладки цехов: градиенты-подсказки скрытого контента + автопрокрутка активной
  const { ref: tabsRef, hints: tabHints } = useScrollHints();

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  useEffect(() => {
    if (!myDeptLoaded) loadMyDept(user?.id);
  }, [myDeptLoaded, loadMyDept, user?.id]);

  /** Цех из привязки erp_employees (автопривязка, п.10) */
  const boundDept = useMemo(
    () => departments.find((dd) => dd.id === myDeptId) || null,
    [departments, myDeptId],
  );

  // Автовыбор своего цеха: пока пользователь не переключил вкладку сам
  const deptCode = !sessionPick && boundDept ? boundDept.code : pickedDept;
  const selectDept = (code) => {
    setPickedDept(code);
    setSessionPick(true);
    localStorage.setItem('erp_my_dept', code);
  };

  // Активная вкладка цеха — всегда в видимой области скролла
  useEffect(() => {
    if (!deptCode) return;
    const el = tabsRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [deptCode, tabsRef]);

  const dept = departments.find((dd) => dd.code === deptCode) || null;
  const deptNameById = useMemo(
    () => new Map(departments.map((dd) => [dd.id, dd.name])),
    [departments],
  );
  const deptShortById = useMemo(
    () => new Map(departments.map((dd) => [dd.id, deptShortName(dd.code, dd.name)])),
    [departments],
  );

  // Привязки нет и нет legacy-выбора (localStorage) → заглушка для рядовых ролей
  const showStub = !privileged && myDeptLoaded && !boundDept && !deptCode;
  // Действия разрешены: рук. состав всюду; при привязке — только в своём цехе;
  // без привязки (legacy localStorage) — как раньше, в выбранном цехе
  const canAct = privileged || !boundDept || (dept ? dept.code === boundDept.code : false);

  /** Счётчик «готово к работе» по каждому цеху — для бейджей на вкладках */
  const readyByDept = useMemo(() => {
    const counts = new Map();
    for (const dd of departments) {
      counts.set(dd.code, readyCountFor(orders, departments, dd.code));
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

  const groups = useMemo(() => {
    const g = { ready: [], in_progress: [], waiting: [], blocked: [], done: [] };
    if (!dept) return g;
    for (const order of orders) {
      if (order.status !== 'active') continue;
      if (!matchesOrderQuery(order, query)) continue;
      for (const item of order.items) {
        for (const stage of item.stages) {
          if (stage.department_id !== dept.id) continue;
          if (stage.status === 'skipped') continue;
          if (onlyOverdue && !(stageOverdue(stage.planned_end, stage.status) && !stage.overdue_ack_at)) continue;
          const entry = { order, item, stage, reason: null };
          const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, stage.id);
          if (stage.status === 'done') {
            g.done.push({ ...entry, group: 'done' });
          } else if (stage.status === 'blocked') {
            g.blocked.push({ ...entry, group: 'blocked' });
          } else if (stage.status === 'in_progress') {
            g.in_progress.push({ ...entry, group: 'in_progress' });
          } else if (isStageReady(stage, item.stages, order.materials, dept.code, awaitProc)) {
            g.ready.push({ ...entry, group: 'ready' });
          } else {
            g.waiting.push({
              ...entry,
              group: 'waiting',
              reason: waitingReason(stage, item.stages, order.materials, deptNameById, dept.code, awaitProc),
            });
          }
        }
      }
    }
    const byDue = (a, b) =>
      (a.order.due_date || '9999').localeCompare(b.order.due_date || '9999');
    g.ready.sort(byDue); g.in_progress.sort(byDue); g.waiting.sort(byDue); g.blocked.sort(byDue);
    g.done.sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''));
    g.done = g.done.slice(0, 10);
    return g;
  }, [orders, dept, deptNameById, query, onlyOverdue]);

  // Подтягиваем причины возврата брака для этапов с qty_rework (баннер получателю)
  useEffect(() => {
    const ids = [...groups.ready, ...groups.in_progress]
      .filter((e) => (e.stage.qty_rework ?? 0) > 0)
      .map((e) => e.stage.id);
    let alive = true;
    // loadStageReworkEvents([]) сразу резолвится в {} — setState только в async-колбэке
    loadStageReworkEvents(ids).then((map) => { if (alive) setReworkByStage(map); });
    return () => { alive = false; };
  }, [groups, loadStageReworkEvents]);

  const onStart = async (entry, plannedEnd) => {
    if (plannedEnd) await setStagePlan(entry.stage.id, { planned_end: plannedEnd });
    await setStageStatus(entry.stage.id, 'in_progress');
  };
  /** «Готово» без числа — закрыть этап целиком */
  const onDone = (entry) =>
    setStageStatus(entry.stage.id, 'done', { qty_done: entry.item.qty });
  /** «Частично» — накопительный прогресс qty_done += N */
  const onProgress = (entry, qty) => reportProgress(entry.stage.id, qty);
  const onBlock = async (entry, reason, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Блокировка: ${reason}`);
    await setStageStatus(entry.stage.id, 'blocked', {
      block_reason: photoOk ? `${reason} (фото во вложениях)` : reason,
    });
    if (photo && !photoOk) toast.warning('Блокировка записана, но фото не загрузилось');
  };
  const onUnblock = (entry) => setStageStatus(entry.stage.id, 'waiting', { block_reason: null });
  const onDefect = async (entry, opts, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Брак: ${opts.reason}`);
    await reportDefect(entry.stage.id, {
      ...opts,
      reason: photoOk ? `${opts.reason} (фото во вложениях)` : opts.reason,
    });
    if (photo && !photoOk) toast.warning('Брак записан, но фото не загрузилось');
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
        sub="Очередь работ цеха: бери в работу, отмечай готово, сообщай о проблемах."
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
        <div className={styles.toolbar}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Поиск: заказ, № сделки, изделие, материал"
            ariaLabel="Поиск в очереди цеха"
          />
          <button
            type="button"
            aria-pressed={onlyOverdue}
            className={`${styles.chip} ${onlyOverdue ? styles.chipBlocked : styles.chipNeutral}`}
            style={{ cursor: 'pointer', font: 'inherit' }}
            onClick={() => setOnlyOverdue((v) => !v)}
          >
            ⏰ Только необработанные просрочки
          </button>
        </div>
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
        return (
          <section key={key} style={{ marginBottom: 'var(--space-lg, 20px)' }}>
            <h2 className={styles.queueGroupTitle}>{title} <span className={styles.subText}>({list.length})</span></h2>
            <div className={styles.queueGrid}>
              {list.map((entry) => (
                <QueueCard
                  key={entry.stage.id}
                  entry={entry}
                  canAct={canAct}
                  rework={reworkByStage[entry.stage.id] || null}
                  deptShortById={deptShortById}
                  onStart={onStart}
                  onDone={onDone}
                  onProgress={onProgress}
                  onBlock={onBlock}
                  onUnblock={onUnblock}
                  onDefect={onDefect}
                  onAckOverdue={ackStageOverdue}
                />
              ))}
            </div>
          </section>
        );
      })}

      {dept && loaded &&
        Object.values(groups).every((l) => l.length === 0) && (
        <div className={styles.emptyState}>В этом цехе пока нет работ.</div>
      )}
    </>
  );
}
