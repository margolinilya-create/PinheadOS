import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Badge } from '../components/Badge';
import { DashboardSkeleton } from '../components/ErpSkeletons';
import { useErpStore, openWarehouseTaskCount } from '../store/useErpStore';
import { isStageReady, hasOpenProcurement } from '../utils/routes';
import { isOrderReadyToShip } from '../utils/stageUi';
import { daysLeft, isUrgent, isOverdue, formatDateShort } from '../utils/time';
import { isQueueDept } from '../data/departments';
import styles from '../erp.module.css';

/**
 * Обзор производства (редизайн, по макету): KPI-плитки, заказы в работе, загрузка цехов,
 * ближайшие дедлайны, быстрые действия, уведомления. Всё на реальных данных стора
 * (в ERP нет выручки/исторической динамики — эти виджеты макета заменены на реальные метрики).
 */

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const QUICK_ACTIONS = [
  { to: '/orders', icon: '➕', label: 'Новый заказ' },
  { to: '/board', icon: '🏭', label: 'Канбан' },
  { to: '/queue', icon: '🔧', label: 'Очередь' },
  { to: '/purchasing', icon: '🚚', label: 'Закупки' },
  { to: '/warehouse', icon: '📦', label: 'Приёмка' },
  { to: '/subcontracting', icon: '🤝', label: 'Подрядчики' },
  { to: '/experimental', icon: '🧪', label: 'Образцы' },
  { to: '/admin', icon: '⚙️', label: 'Настройки' },
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
  if (isOrderReadyToShip(order)) return { variant: 'ready', label: 'Готово' };
  if (isOverdue(order.due_date)) return { variant: 'blocked', label: 'Просрочено' };
  if (isUrgent(order.due_date)) return { variant: 'waiting', label: 'Срочно' };
  return { variant: 'progress', label: 'В работе' };
}

export default function ErpDashboard() {
  const { orders, departments, loaded, loadAll } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
    })),
  );

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

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

    for (const order of active) {
      const d = daysLeft(order.due_date);
      if (isOverdue(order.due_date)) overdue += 1;
      else if (isUrgent(order.due_date)) dueSoon += 1;
      if (d !== null && d <= 3) burning.push({ order, days: d });

      if (hasOpenProcurement(order.procurement_tasks)) {
        notifications.push({ id: `p-${order.id}`, icon: '🔔', variant: 'warn',
          text: `Дозакупка по заказу №${order.bitrix_id || '—'}`, sub: order.title });
      }
      if (isOverdue(order.due_date)) {
        notifications.push({ id: `o-${order.id}`, icon: '⚠️', variant: 'danger',
          text: `Просрочен заказ №${order.bitrix_id || '—'}`, sub: order.title });
      }

      for (const item of order.items) {
        itemsInWork += 1;
        for (const stage of item.stages) {
          const slot = deptLoad.get(stage.department_id);
          if (!slot) continue;
          if (stage.status === 'in_progress') slot.inProgress += 1;
          else if (stage.status === 'blocked') slot.blocked += 1;
          else if (stage.status === 'waiting' && isStageReady(stage, item.stages, order.materials, slot.dept.code)) {
            slot.ready += 1;
          }
        }
      }
    }
    burning.sort((a, b) => a.days - b.days);

    const loadRows = [...deptLoad.values()]
      .map((s) => ({ dept: s.dept, load: s.ready + s.inProgress + s.blocked }))
      .filter((s) => isQueueDept(s.dept.code) && s.load > 0)
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
      notifications: notifications.slice(0, 6),
    };
  }, [orders, departments]);

  return (
    <>
      <PageHead
        title="Обзор производства"
        sub="Где какой заказ, загрузка цехов, горящие сроки — всё в одном месте."
      />

      {!loaded && <DashboardSkeleton />}

      {loaded && (
        <div className={styles.dash}>
          {/* KPI */}
          <div className={styles.dashKpis}>
            <Link to="/orders" className={styles.kpiCard}>
              <span className={styles.kpiIcon}>📋</span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Заказов в работе</span>
                <span className={styles.kpiCardValue}>{data.activeOrders}</span>
              </span>
            </Link>
            <Link to="/board" className={styles.kpiCard}>
              <span className={styles.kpiIcon}>🏭</span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Позиций в работе</span>
                <span className={styles.kpiCardValue}>{data.itemsInWork}</span>
              </span>
            </Link>
            <Link to="/orders?filter=ready" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconOk}`}>✅</span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Готовы к отгрузке</span>
                <span className={styles.kpiCardValue}>{data.readyToShip}</span>
              </span>
            </Link>
            <Link to="/orders?filter=urgent" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconWarn}`}>⏱️</span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Срок ≤ 3 дней</span>
                <span className={styles.kpiCardValue}>{data.dueSoon}</span>
              </span>
            </Link>
            <Link to="/orders?filter=overdue" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconDanger}`}>⚠️</span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Просрочено</span>
                <span className={styles.kpiCardValue}>{data.overdue}</span>
              </span>
            </Link>
            <Link to="/warehouse" className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${styles.kpiIconViolet}`}>📦</span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>Задач на складе</span>
                <span className={styles.kpiCardValue}>{data.warehouseOpen}</span>
              </span>
            </Link>
          </div>

          {/* Заказы в работе / Загрузка цехов / Дедлайны */}
          <div className={`${styles.dashRow} ${styles.dashRow3}`}>
            <div className={styles.widget}>
              <div className={styles.widgetHead}>
                <span className={styles.widgetTitle}>Заказы в работе</span>
                <Link to="/orders" className={styles.widgetLink}>Смотреть все →</Link>
              </div>
              {data.inWork.length === 0 ? (
                <div className={styles.emptyState}>Активных заказов нет.</div>
              ) : (
                <div className={styles.tableWrap}>
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
                </div>
              )}
            </div>

            <div className={styles.widget}>
              <div className={styles.widgetHead}><span className={styles.widgetTitle}>Загрузка цехов</span></div>
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
              <div className={styles.widgetHead}><span className={styles.widgetTitle}>Ближайшие дедлайны</span></div>
              {data.burning.length === 0 ? (
                <div className={styles.emptyState}>Горящих сроков нет.</div>
              ) : (
                data.burning.map(({ order, days }) => {
                  const dt = order.due_date ? new Date(order.due_date) : null;
                  const label = days < 0 ? `просрочен ${-days} дн.` : days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} дн.`;
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
              <div className={styles.widgetHead}><span className={styles.widgetTitle}>Быстрые действия</span></div>
              <div className={styles.quickGrid}>
                {QUICK_ACTIONS.map((a) => (
                  <Link key={a.to} to={a.to} className={styles.quickAction}>
                    <span className={styles.quickIcon}>{a.icon}</span>
                    {a.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className={styles.widget}>
              <div className={styles.widgetHead}><span className={styles.widgetTitle}>Уведомления</span></div>
              {data.notifications.length === 0 ? (
                <div className={styles.emptyState}>Всё спокойно — уведомлений нет.</div>
              ) : (
                data.notifications.map((n) => (
                  <div key={n.id} className={styles.notifItem}>
                    <span aria-hidden="true">{n.icon}</span>
                    <span className={styles.notifText}>
                      {n.text}
                      <span className={styles.notifSub}> · {n.sub}</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
