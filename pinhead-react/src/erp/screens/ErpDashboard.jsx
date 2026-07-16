import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { isStageReady } from '../utils/routes';
import { isQueueDept } from '../data/departments';
import styles from '../erp.module.css';

/**
 * Обзор производства: KPI, загрузка цехов, горящие заказы.
 * Прозрачность = директор и руководители видят всё сразу.
 */

function daysLeft(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
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

  const stats = useMemo(() => {
    const active = orders.filter((o) => o.status === 'active');
    let itemsInWork = 0;
    let overdue = 0;
    let dueSoon = 0;
    const deptLoad = new Map(
      departments.map((d) => [d.id, { dept: d, ready: 0, inProgress: 0, blocked: 0, qty: 0 }]),
    );
    const burning = [];

    for (const order of active) {
      const d = daysLeft(order.due_date);
      if (d !== null && d < 0) overdue += 1;
      else if (d !== null && d <= 3) dueSoon += 1;
      if (d !== null && d <= 3) burning.push({ order, days: d });

      for (const item of order.items) {
        itemsInWork += 1;
        for (const stage of item.stages) {
          const slot = deptLoad.get(stage.department_id);
          if (!slot) continue;
          if (stage.status === 'in_progress') { slot.inProgress += 1; slot.qty += item.qty; }
          else if (stage.status === 'blocked') slot.blocked += 1;
          else if (
            stage.status === 'waiting' &&
            isStageReady(stage, item.stages, order.materials, slot.dept.code)
          ) { slot.ready += 1; slot.qty += item.qty; }
        }
      }
    }
    burning.sort((a, b) => a.days - b.days);
    return {
      activeOrders: active.length,
      itemsInWork,
      overdue,
      dueSoon,
      deptLoad: [...deptLoad.values()].filter(
        (s) => isQueueDept(s.dept.code) && s.ready + s.inProgress + s.blocked > 0,
      ),
      burning: burning.slice(0, 8),
    };
  }, [orders, departments]);

  return (
    <>
      <PageHead
        title="Обзор производства"
        sub="Где какой заказ, загрузка цехов, горящие сроки — всё в одном месте."
      />

      <div className={styles.kpiGrid}>
        <Link to="/orders" className={styles.kpiTile}>
          <div className={styles.kpiValue}>{stats.activeOrders}</div>
          <div className={styles.kpiLabel}>Заказов в работе</div>
        </Link>
        <Link to="/board" className={styles.kpiTile}>
          <div className={styles.kpiValue}>{stats.itemsInWork}</div>
          <div className={styles.kpiLabel}>Позиций в работе</div>
        </Link>
        <div className={`${styles.kpiTile} ${stats.dueSoon > 0 ? styles.kpiWarn : ''}`}>
          <div className={styles.kpiValue}>{stats.dueSoon}</div>
          <div className={styles.kpiLabel}>Срок ≤ 3 дней</div>
        </div>
        <div className={`${styles.kpiTile} ${stats.overdue > 0 ? styles.kpiDanger : ''}`}>
          <div className={styles.kpiValue}>{stats.overdue}</div>
          <div className={styles.kpiLabel}>Просрочено</div>
        </div>
      </div>

      <h2 className={styles.queueGroupTitle}>Загрузка цехов</h2>
      <div className={styles.cardGrid}>
        {stats.deptLoad.map(({ dept, ready, inProgress, blocked }) => (
          <div key={dept.id} className={styles.card}>
            <div className={styles.cardName}>
              {dept.name}
              {dept.is_branding && <span className={styles.badge}>брендирование</span>}
            </div>
            <div className={styles.cardMetric}>
              <span className={`${styles.chip} ${styles.chipReady}`}>готово: {ready}</span>{' '}
              <span className={`${styles.chip} ${styles.chipProgress}`}>в работе: {inProgress}</span>
              {blocked > 0 && (
                <>
                  {' '}<span className={`${styles.chip} ${styles.chipBlocked}`}>блок: {blocked}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {stats.burning.length > 0 && (
        <>
          <h2 className={styles.queueGroupTitle} style={{ marginTop: 'var(--space-lg, 20px)' }}>
            🔥 Горящие заказы
          </h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>№</th><th>Заказ</th><th>Менеджер</th><th>Срок</th><th>Осталось</th></tr>
              </thead>
              <tbody>
                {stats.burning.map(({ order, days }) => (
                  <tr key={order.id}>
                    <td>{order.bitrix_id || '—'}</td>
                    <td><strong>{order.title}</strong></td>
                    <td>{order.manager || '—'}</td>
                    <td>{new Date(order.due_date + 'T00:00:00').toLocaleDateString('ru-RU')}</td>
                    <td className={days < 0 ? styles.overdue : styles.dueSoon}>
                      {days >= 0 ? `${days} дн.` : `просрочен ${-days} дн.`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
