import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { orderLinkClick } from '../store/useOrderDrawer';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Badge } from '../components/Badge';
import { DashboardSkeleton } from '../components/ErpSkeletons';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { LoadFailed } from '../components/ErpStates';
import { Icon } from '../components/Icon';
import { useErpStore, openWarehouseTaskCount } from '../store/useErpStore';
import { isStageReady, hasOpenProcurement, materialsForItem } from '../utils/routes';
import { stageMissingTz } from '../utils/tz';
import { isOrderReadyToShip, isOrderOverdue, orderOverdueDays } from '../utils/stageUi';
import { daysLeft, isUrgent, formatDateShort } from '../utils/time';
import { isProductionDept } from '../data/departments';
import { overdueBucket, OVERDUE_BUCKET_SHORT } from '../utils/format';
import { groupNotices, urgentCount } from '../utils/notifications';
import { CapacityBar } from '../components/CapacityBar';
import { monthCapacityReport, monthLabel } from '../utils/capacity';
import { localToday } from '../utils/orderForm';
import styles from '../erp.module.css';
import { dueLabel } from '../utils/format';

/**
 * Обзор производства (редизайн, по макету): KPI-плитки, заказы в работе, загрузка цехов,
 * ближайшие дедлайны, быстрые действия, уведомления. Всё на реальных данных стора
 * (в ERP нет выручки/исторической динамики — эти виджеты макета заменены на реальные метрики).
 */

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const QUICK_ACTIONS = [
  { to: '/orders?new=1', icon: 'plus', label: 'Новый заказ' },
  { to: '/board', icon: 'board', label: 'Канбан' },
  { to: '/queue', icon: 'queue', label: 'Очередь' },
  { to: '/purchasing', icon: 'truck', label: 'Закупки' },
  { to: '/warehouse', icon: 'box', label: 'Приёмка' },
  { to: '/subcontracting', icon: 'users', label: 'Подрядчики' },
  { to: '/experimental', icon: 'flask', label: 'Образцы' },
  { to: '/admin', icon: 'settings', label: 'Настройки' },
];

/** Текущий этап заказа (для колонки «Цех/этап») */
function currentStageName(order, deptById) {
  for (const it of order.items) {
    const st =
      it.stages.find((s) => s.status === 'in_progress') ||
      it.stages.find((s) => s.status === 'ready' || s.status === 'waiting') ||
      it.stages.find((s) => s.status !== 'done' && s.status !== 'skipped');
    if (st) return deptById.get(st.department_id)?.name || '—';
  }
  return 'Готово';
}

/** Статус заказа для бейджа */
function orderStatus(order) {
  // Готовность проверяется первой и в `isOrderOverdue` тоже: готовый заказ
  // ждёт логистики, а не производства, и «Просрочено» на нём вводит в заблуждение.
  if (isOrderReadyToShip(order)) return { variant: 'ready', label: 'Готово' };
  if (isOrderOverdue(order, daysLeft(order.due_date))) return { variant: 'blocked', label: 'Просрочено' };
  if (isUrgent(order.due_date)) return { variant: 'waiting', label: 'Срочно' };
  return { variant: 'progress', label: 'В работе' };
}

export default function ErpDashboard() {
  const {
    orders, departments, loaded, loadError, loadAll, capacity, capacityLoaded, loadSettings,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      capacity: s.capacity,
      capacityLoaded: s.capacityLoaded,
      loadSettings: s.loadSettings,
    })),
  );
  /**
   * ЛОКАЛЬНАЯ дата, а не UTC. `toISOString()` в UTC+3 в 01:00 первого сентября
   * отдаёт «31 августа»: обзор показывал бы августовскую мощность и подпись
   * «август» на первой смене сентября, тогда как вкладка мощности в админке
   * (она считает через `localToday`) в тот же момент показывает сентябрь.
   */
  const today = localToday();

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);
  useEffect(() => { if (!capacityLoaded) loadSettings(); }, [capacityLoaded, loadSettings]);

  // Колокол в шапке ведёт на /#notifications — проскроллить к виджету «Уведомления» (ERP-16),
  // когда данные загружены (виджет рендерится только при loaded).
  const location = useLocation();
  useEffect(() => {
    if (loaded && location.hash === '#notifications') {
      document.getElementById('notifications')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loaded, location.hash]);

  const data = useMemo(() => {
    const deptById = new Map(departments.map((d) => [d.id, d]));
    const active = orders.filter((o) => o.status === 'active');
    let itemsInWork = 0;
    let overdue = 0;
    let dueSoon = 0;
    const deptLoad = new Map(
      departments.map((d) => [d.id, { dept: d, ready: 0, inProgress: 0, blocked: 0 }]),
    );
    const burning = [];
    const notifications = [];
    // Ступени просрочки: «47» одним числом не отвечает на вопрос «что делать»
    const overdueByBucket = { none: 0, week: 0, month: 0, stale: 0 };

    for (const order of active) {
      const d = daysLeft(order.due_date);
      const lateDays = orderOverdueDays(order, d);
      if (lateDays > 0) overdue += 1;
      else if (isUrgent(order.due_date)) dueSoon += 1;
      if (d !== null && d <= 3) burning.push({ order, days: d });

      if (hasOpenProcurement(order.procurement_tasks)) {
        notifications.push({ id: `p-${order.id}`, orderId: order.id, kind: 'procurement',
          text: `Дозакупка по заказу №${order.bitrix_id || '—'}`, sub: order.title });
      }
      if (lateDays > 0) {
        notifications.push({ id: `o-${order.id}`, orderId: order.id, kind: 'overdue',
          text: `Просрочен заказ №${order.bitrix_id || '—'}`, sub: order.title,
          overdueDays: lateDays });
        overdueByBucket[overdueBucket(lateDays)] += 1;
      }
      // Остановленный этап — единственное, что нельзя «подождать»: цех стоит
      if (order.items.some((it) => it.stages.some((st) => st.status === 'blocked'))) {
        notifications.push({ id: `b-${order.id}`, orderId: order.id, kind: 'blocked',
          text: `Остановлен этап по заказу №${order.bitrix_id || '—'}`, sub: order.title });
      }

      for (const item of order.items) {
        itemsInWork += 1;
        for (const stage of item.stages) {
          const slot = deptLoad.get(stage.department_id);
          if (!slot) continue;
          if (stage.status === 'in_progress') slot.inProgress += 1;
          else if (stage.status === 'blocked') slot.blocked += 1;
          else if (stage.status === 'waiting' && isStageReady(
            stage, item.stages, materialsForItem(order.materials, item.id), slot.dept, false,
            stageMissingTz(order, item.id, slot.dept))) {
            slot.ready += 1;
          }
        }
      }
    }
    burning.sort((a, b) => a.days - b.days);

    const loadRows = [...deptLoad.values()]
      .map((s) => ({ dept: s.dept, load: s.ready + s.inProgress + s.blocked }))
      .filter((s) => isProductionDept(s.dept) && s.load > 0)
      .sort((a, b) => b.load - a.load);
    const maxLoad = Math.max(1, ...loadRows.map((r) => r.load));

    const inWork = [...active]
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))
      .slice(0, 6)
      .map((o) => ({
        order: o,
        product: o.items[0]?.product_type || '—',
        stage: currentStageName(o, deptById),
        qty: o.items.reduce((s, it) => s + (it.qty || 0), 0),
        status: orderStatus(o),
      }));

    return {
      activeOrders: active.length,
      itemsInWork,
      readyToShip: active.filter((o) => isOrderReadyToShip(o)).length,
      overdue,
      dueSoon,
      warehouseOpen: openWarehouseTaskCount(orders),
      loadRows,
      maxLoad,
      burning: burning.slice(0, 5),
      inWork,
      overdueByBucket,
      // Группы, а не срез: срез показывал шесть случайных из сорока семи
      // и молчал о том, что их сорок семь
      noticeGroups: groupNotices(notifications),
      capacity: monthCapacityReport(orders, today, capacity),
    };
  }, [orders, departments, capacity, today]);

  // Число для шапки виджета: сумма срочных групп, а не всех уведомлений
  const urgent = urgentCount(data.noticeGroups);

  return (
    <>
      <PageHead
        title="Обзор производства"
        sub="Где какой заказ, загрузка цехов, горящие сроки — всё в одном месте."
      />

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="обзор производства" />}
      {!loadError && !loaded && <DashboardSkeleton />}

      {loaded && (
        <div className={styles.dash}>
          {/* KPI */}
          <div className={styles.dashKpis}>
            <Link to="/orders" className={styles.kpiCard}>
              <span className={styles.kpiIcon}><Icon name="orders" size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Заказов в работе</span>
                <span className={styles.kpiCardValue}>{data.activeOrders}</span>
              </span>
            </Link>
            <Link to="/board" className={styles.kpiCard}>
              <span className={styles.kpiIcon}><Icon name="board" size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Позиций в работе</span>
                <span className={styles.kpiCardValue}>{data.itemsInWork}</span>
              </span>
            </Link>
            <Link to="/orders?filter=ready" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconOk}`}><Icon name="checkCircle" size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Готовы к отгрузке</span>
                <span className={styles.kpiCardValue}>{data.readyToShip}</span>
              </span>
            </Link>
            <Link to="/orders?filter=urgent" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconWarn}`}><Icon name="clock" size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Срок ≤ 3 дней</span>
                <span className={styles.kpiCardValue}>{data.dueSoon}</span>
              </span>
            </Link>
            <Link to="/orders?filter=overdue" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconDanger}`}><Icon name="alert" size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Просрочено</span>
                <span className={styles.kpiCardValue}>{data.overdue}</span>
                {/* Разбивка по ступеням прямо на плитке: «47» одним числом
                    не отвечает на вопрос «сколько из этого горит сегодня».
                    На боевых данных 03.08.2026 это 6 / 39 / 2. */}
                {data.overdue > 0 && (
                  <span className={styles.kpiBreakdown}>
                    {data.overdueByBucket.week > 0 && (
                      <span className={styles.kpiBreakdownHot}>
                        {OVERDUE_BUCKET_SHORT.week}: {data.overdueByBucket.week}
                      </span>
                    )}
                    {data.overdueByBucket.month > 0 && (
                      <span>{OVERDUE_BUCKET_SHORT.month}: {data.overdueByBucket.month}</span>
                    )}
                    {data.overdueByBucket.stale > 0 && (
                      <span>{OVERDUE_BUCKET_SHORT.stale}: {data.overdueByBucket.stale}</span>
                    )}
                  </span>
                )}
              </span>
            </Link>
            <Link to="/warehouse" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconViolet}`}><Icon name="box" size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Задач на складе</span>
                <span className={styles.kpiCardValue}>{data.warehouseOpen}</span>
              </span>
            </Link>
          </div>

          {/* Загрузка производства против общей мощности (правки заказчика 10.08).
              Стоит над блоками цехов сознательно: «влезаем ли мы в месяц» —
              вопрос раньше, чем «какой цех занят сильнее». */}
          <CapacityBar report={data.capacity} periodLabel={monthLabel(today)} />

          {/* Заказы в работе / Задачи по цехам / Дедлайны */}
          <div className={`${styles.dashRow} ${styles.dashRow3}`}>
            <div className={styles.widget}>
              <div className={styles.widgetHead}>
                <h2 className={styles.widgetTitle}>Заказы в работе</h2>
                <Link to="/orders" className={styles.widgetLink}>Смотреть все →</Link>
              </div>
              {data.inWork.length === 0 ? (
                <div className={styles.emptyState}>Активных заказов нет.</div>
              ) : (
                <ScrollHintBox className={styles.tableWrap} label="Заказы в работе">
                  <table className={styles.table}>
                    <thead>
                      <tr><th>№</th><th>Изделие</th><th>Цех/этап</th><th>Кол-во</th><th>Срок</th><th>Статус</th></tr>
                    </thead>
                    <tbody>
                      {data.inWork.map(({ order, product, stage, qty, status }) => (
                        <tr key={order.id}>
                          <td><Link to={`/orders/${order.id}`}>{order.bitrix_id || '—'}</Link></td>
                          <td><span className={styles.cellTitle} title={product}>{product}</span></td>
                          <td>{stage}</td>
                          <td>{qty} шт</td>
                          <td>{formatDateShort(order.due_date) || '—'}</td>
                          <td><Badge variant={status.variant}>{status.label}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollHintBox>
              )}
            </div>

            <div className={styles.widget}>
              {/* «Задачи по цехам», а не «Загрузка цехов» (решение заказчика 10.08):
                  блок считает ЭТАПЫ, а экран /load — штуки. Одно слово на две разные
                  величины заставляло сверять цифры, которые сойтись не могут. */}
              <div className={styles.widgetHead}><h2 className={styles.widgetTitle}>Задачи по цехам</h2></div>
              {data.loadRows.length === 0 ? (
                <div className={styles.emptyState}>Цеха свободны.</div>
              ) : (
                data.loadRows.map(({ dept, load }) => (
                  <div key={dept.id} className={styles.loadRow}>
                    <span className={styles.loadName} title={dept.name}>{dept.name}</span>
                    <span className={styles.loadTrack}>
                      <span className={styles.loadFill} style={{ width: `${Math.round((load / data.maxLoad) * 100)}%` }} />
                    </span>
                    <span className={styles.loadVal}>{load}</span>
                  </div>
                ))
              )}
            </div>

            <div className={styles.widget}>
              <div className={styles.widgetHead}><h2 className={styles.widgetTitle}>Ближайшие дедлайны</h2></div>
              {data.burning.length === 0 ? (
                <div className={styles.emptyState}>Горящих сроков нет.</div>
              ) : (
                data.burning.map(({ order, days }) => {
                  const dt = order.due_date ? new Date(order.due_date) : null;
                  const label = dueLabel(days);
                  return (
                    <Link key={order.id} to={`/orders/${order.id}`} className={styles.deadlineItem} style={{ textDecoration: 'none' }}>
                      <span className={styles.deadlineDate}>
                        <span className={styles.deadlineDay}>{dt ? dt.getDate() : '—'}</span>
                        <span className={styles.deadlineMon}>{dt ? MONTHS[dt.getMonth()] : ''}</span>
                      </span>
                      <span className={styles.deadlineBody}>
                        <span className={styles.deadlineName} title={order.title}>{order.title}</span>
                        <span className={styles.deadlineMeta}>№{order.bitrix_id || '—'} · {order.manager || '—'}</span>
                      </span>
                      <Badge variant={days < 0 ? 'blocked' : days <= 1 ? 'waiting' : 'neutral'}>{label}</Badge>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* Быстрые действия / Уведомления */}
          <div className={`${styles.dashRow} ${styles.dashRow2}`}>
            <div className={styles.widget}>
              <div className={styles.widgetHead}><h2 className={styles.widgetTitle}>Быстрые действия</h2></div>
              <div className={styles.quickGrid}>
                {QUICK_ACTIONS.map((a) => (
                  <Link key={a.to} to={a.to} className={styles.quickAction}>
                    <span className={styles.quickIcon}><Icon name={a.icon} size={18} /></span>
                    {a.label}
                  </Link>
                ))}
              </div>
            </div>

            <div id="notifications" className={styles.widget} style={{ scrollMarginTop: 16 }}>
              <div className={styles.widgetHead}>
                <h2 className={styles.widgetTitle}>Уведомления</h2>
                {urgent > 0 && (
                  <span className={styles.subText}>требуют действия сейчас: {urgent}</span>
                )}
              </div>
              {data.noticeGroups.length === 0 ? (
                <div className={styles.emptyState}>Всё спокойно — уведомлений нет.</div>
              ) : (
                data.noticeGroups.map((g) => (
                  /* Группа — <details>: сворачивание нативное, значит работает
                     с клавиатуры и читается скринридером без единой строки JS.
                     Срочные группы открыты (`open`), давняя просрочка свёрнута
                     со счётчиком: она важна, но это не сегодняшняя работа. */
                  <details key={g.key} className={styles.notifGroup} open={g.open}>
                    <summary className={styles.notifSummary}>
                      <span className={`${styles.notifDot} ${styles[`notifDot_${g.tone}`]}`} aria-hidden="true" />
                      <Icon name={g.icon} size={15} />
                      <span className={styles.notifGroupTitle}>{g.title}</span>
                      <span className={styles.notifCount}>{g.items.length}</span>
                    </summary>
                    <p className={styles.notifHint}>{g.hint}</p>
                    {g.items.slice(0, 8).map((n) => (
                      // Алерт без ссылки — тупик: пользователь читал «Просрочен
                      // заказ №1042» и шёл искать его руками, хотя id лежит рядом
                      <Link
                        key={n.id}
                        to={`/orders/${n.orderId}`}
                        onClick={(e) => orderLinkClick(n.orderId, e)}
                        className={styles.notifItem}
                      >
                        <span className={styles.notifText}>
                          {n.text}
                          <span className={styles.notifSub}> · {n.sub}</span>
                        </span>
                        {n.overdueDays > 0 && (
                          <Badge variant={g.tone === 'danger' ? 'blocked' : 'neutral'}>
                            {n.overdueDays} дн.
                          </Badge>
                        )}
                      </Link>
                    ))}
                    {g.items.length > 8 && (
                      // Никаких тихих лимитов: сколько показано и сколько всего
                      <Link to="/orders?filter=overdue" className={styles.notifMore}>
                        Показаны 8 из {g.items.length} → все в списке заказов
                      </Link>
                    )}
                  </details>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
