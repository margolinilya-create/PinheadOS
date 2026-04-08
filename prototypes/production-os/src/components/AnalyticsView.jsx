import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import styles from './AnalyticsView.module.css';
import ThroughputPanel from './analytics/ThroughputPanel';
import OrderStatusPanel from './analytics/OrderStatusPanel';
import CycleTimePanel from './analytics/CycleTimePanel';
import DailyLoadPanel from './analytics/DailyLoadPanel';
import WorkerPerformancePanel from './analytics/WorkerPerformancePanel';

export default function AnalyticsView() {
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);

  const totalDone = tasks.filter(t => t.status === 'done').length;
  const totalBlocked = tasks.filter(t => t.status === 'blocked').length;
  const totalActive = tasks.filter(t => t.status === 'in_progress').length;

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerTitleWrap}>
            <h1 className={styles.headerTitle}>АНАЛИТИКА</h1>
            <span className={styles.headerSub}>Production Analytics</span>
          </div>
          <div className={styles.headerKpis}>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{totalDone}</span>
              <span className={styles.kpiLabel}>завершено</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{totalActive}</span>
              <span className={styles.kpiLabel}>в работе</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{totalBlocked}</span>
              <span className={styles.kpiLabel}>заблок.</span>
            </div>
          </div>
        </div>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← К цехам
        </button>
      </header>

      {/* Dashboard grid */}
      <main className={styles.main}>
        <div className={styles.grid}>
          <ThroughputPanel tasks={tasks} />
          <OrderStatusPanel tasks={tasks} orders={orders} />
          <CycleTimePanel tasks={tasks} />
          <DailyLoadPanel tasks={tasks} />
        </div>
        <div className={styles.workersSection}>
          <WorkerPerformancePanel tasks={tasks} />
        </div>
      </main>
    </div>
  );
}
