import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import PageHeader from '../../../components/shared/PageHeader';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../../store/useOrdersStore';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES } from '../../../data';
import { getDeadlineColor, getDeadlineLabel } from '../../utils/deadline';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
} from 'chart.js';
import styles from './Dashboard.module.css';
import { SkeletonTable } from '../../../components/shared/Skeleton';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Filler, Title, Tooltip, Legend);

/* ── Constants ── */
const PERIODS = [
  { key: 7, label: '7 дней' },
  { key: 30, label: '30 дней' },
  { key: 90, label: '90 дней' },
  { key: 0, label: 'Всё' },
];

const CATEGORY_COLORS = {
  tshirts: '#1D19EA', tee: '#1D19EA',
  hoodies: '#c04500', hoodie: '#c04500',
  sweatshirts: '#b89000', sweat: '#b89000',
  longsleeves: '#007840', longsleeve: '#007840',
  pants: '#888', shorts: '#555',
};

const CHART_FONT = { family: 'Inter, sans-serif', size: 10 };
const CHART_OPTS_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y?.toLocaleString('ru-RU') + ' ₽' || ctx.parsed.x?.toLocaleString('ru-RU') + ' ₽' } } },
  scales: { x: { ticks: { font: CHART_FONT } }, y: { ticks: { font: CHART_FONT } } },
};

/* ── Helpers ── */
function filterByPeriod(orders, days) {
  if (!days) return orders;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return orders.filter(o => new Date(o.created_at) >= cutoff);
}

function getWeekLabel(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
  return `Нед. ${weekNum}`;
}

function groupByWeek(orders) {
  const map = {};
  orders.forEach(o => {
    const week = getWeekLabel(o.created_at);
    if (!map[week]) map[week] = { week, sum: 0, count: 0 };
    map[week].sum += o.total_sum || 0;
    map[week].count++;
  });
  return Object.values(map).slice(-12);
}

function groupByStatus(orders) {
  const map = {};
  orders.forEach(o => {
    const s = o.status || 'draft';
    if (!map[s]) map[s] = { status: s, name: STATUS_LABELS[s] || s, value: 0, color: (STATUS_COLORS[s] || STATUS_COLORS.draft).bar };
    map[s].value += o.total_sum || 0;
  });
  return Object.values(map).filter(d => d.value > 0);
}

function groupByManager(orders) {
  const map = {};
  orders.forEach(o => {
    const name = o.data?.managerName || o.created_by || 'Неизвестно';
    if (!map[name]) map[name] = { name, sum: 0, count: 0 };
    map[name].sum += o.total_sum || 0;
    map[name].count++;
  });
  return Object.values(map).sort((a, b) => b.sum - a.sum).slice(0, 5);
}

function exportCSV(orders) {
  const header = 'Номер;Дата;Статус;Клиент;Тип;Тираж;Сумма;Bitrix\n';
  const rows = orders.map(o => {
    const d = o.data || {};
    return [
      o.order_number, new Date(o.created_at).toLocaleDateString('ru-RU'),
      STATUS_LABELS[o.status] || o.status, d.name || '', TYPE_NAMES[o.item_type] || o.item_type || '',
      o.total_qty || 0, o.total_sum || 0, o.bitrix_deal || '',
    ].join(';');
  }).join('\n');
  const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `pinhead-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

/* ── Analytics Tab ── */
function AnalyticsTab({ orders, period, setPeriod, navigate, loadOrder }) {
  const filtered = useMemo(() => filterByPeriod(orders, period), [orders, period]);
  const totalSum = filtered.reduce((s, o) => s + (o.total_sum || 0), 0);
  const totalQty = filtered.reduce((s, o) => s + (o.total_qty || 0), 0);
  const avgCheck = filtered.length ? Math.round(totalSum / filtered.length) : 0;
  const avgQty = filtered.length ? Math.round(totalQty / filtered.length) : 0;
  const doneCount = filtered.filter(o => o.status === 'done').length;
  const conversion = filtered.length ? ((doneCount / filtered.length) * 100).toFixed(1) : '0';
  const inWork = filtered.filter(o => o.status === 'approved' || o.status === 'production');
  const inWorkQty = inWork.reduce((s, o) => s + (o.total_qty || 0), 0);

  const weeklyData = useMemo(() => groupByWeek(filtered), [filtered]);
  const statusData = useMemo(() => groupByStatus(filtered), [filtered]);
  const managerData = useMemo(() => groupByManager(filtered), [filtered]);
  const recentOrders = useMemo(() =>
    [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10),
    [filtered]
  );

  const topSku = useMemo(() => {
    const skuStats = {};
    filtered.forEach(order => {
      const items = order.data?.items;
      if (Array.isArray(items) && items.length > 0) {
        items.forEach(it => {
          const key = it.sku?.code || it.sku?.name || order.item_type || '—';
          const name = it.sku?.name || order.item_type || '—';
          if (!skuStats[key]) skuStats[key] = { name, qty: 0, orders: 0, sum: 0 };
          skuStats[key].qty += Object.values(it.sizes || {}).reduce((a, b) => a + (b || 0), 0);
          skuStats[key].orders += 1;
          skuStats[key].sum += it.total || 0;
        });
      } else {
        const key = order.item_type || '—';
        if (!skuStats[key]) skuStats[key] = { name: key, qty: 0, orders: 0, sum: 0 };
        skuStats[key].qty += order.total_qty || 0;
        skuStats[key].orders += 1;
        skuStats[key].sum += order.total_sum || 0;
      }
    });
    return Object.values(skuStats).sort((a, b) => b.qty - a.qty).slice(0, 10);
  }, [filtered]);

  // Chart.js data
  const areaChartData = {
    labels: weeklyData.map(d => d.week),
    datasets: [{
      data: weeklyData.map(d => d.sum),
      borderColor: '#1D19EA',
      backgroundColor: 'rgba(29,25,234,0.1)',
      fill: true,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 3,
    }],
  };

  const managerChartData = {
    labels: managerData.map(d => d.name),
    datasets: [{
      data: managerData.map(d => d.sum),
      backgroundColor: '#1D19EA',
      borderRadius: 2,
    }],
  };

  const statusChartData = {
    labels: statusData.map(d => d.name),
    datasets: [{
      data: statusData.map(d => d.value),
      backgroundColor: statusData.map(d => d.color),
      borderWidth: 0,
    }],
  };

  return (
    <>
      {/* Period + Export */}
      <div className="dash-toolbar">
        <div className="dash-period">
          {PERIODS.map(p => (
            <button key={p.key} className={`dash-period-btn${period === p.key ? ' active' : ''}`} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => exportCSV(filtered)}>Экспорт CSV</button>
      </div>

      {/* 6 Metrics */}
      <div className="dash-metrics dash-metrics-6">
        <div className="dash-metric">
          <div className="dash-metric-label">Заказов</div>
          <div className="dash-metric-value">{filtered.length}</div>
        </div>
        <div className="dash-metric">
          <div className="dash-metric-label">Сумма</div>
          <div className="dash-metric-value">{totalSum.toLocaleString('ru-RU')} ₽</div>
        </div>
        <div className="dash-metric">
          <div className="dash-metric-label">Ср. чек</div>
          <div className="dash-metric-value">{avgCheck.toLocaleString('ru-RU')} ₽</div>
        </div>
        <div className="dash-metric">
          <div className="dash-metric-label">Ср. тираж</div>
          <div className="dash-metric-value">{avgQty} шт</div>
        </div>
        <div className="dash-metric">
          <div className="dash-metric-label">Конверсия</div>
          <div className="dash-metric-value dash-metric-success">{conversion}%</div>
        </div>
        <div className="dash-metric">
          <div className="dash-metric-label">В работе</div>
          <div className="dash-metric-value">{inWork.length} <span className="dash-metric-sub">({inWorkQty} шт)</span></div>
        </div>
      </div>

      {/* Chart: Revenue by week */}
      <div className="dash-chart">
        <div className="dash-chart-title">Выручка по неделям</div>
        <div style={{ height: 220 }}>
          <Line data={areaChartData} options={{ ...CHART_OPTS_BASE, plugins: { ...CHART_OPTS_BASE.plugins, legend: { display: false } } }} />
        </div>
      </div>

      <div className="dash-row">
        {/* Top managers */}
        <div className="dash-chart dash-chart-half">
          <div className="dash-chart-title">Топ менеджеры по выручке</div>
          <div style={{ height: 200 }}>
            <Bar data={managerChartData} options={{
              ...CHART_OPTS_BASE,
              indexAxis: 'y',
              scales: { x: { ticks: { font: CHART_FONT } }, y: { ticks: { font: CHART_FONT } } },
            }} />
          </div>
        </div>

        {/* Revenue by status */}
        <div className="dash-chart dash-chart-half">
          <div className="dash-chart-title">Выручка по статусам</div>
          <div style={{ height: 200 }}>
            <Doughnut data={statusChartData} options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { font: CHART_FONT } },
                tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed.toLocaleString('ru-RU') + ' ₽' } },
              },
            }} />
          </div>
        </div>
      </div>

      {/* Recent orders table */}
      <div className="dash-chart">
        <div className="dash-chart-title">Последние заказы</div>
        <table className="sku-ed-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Клиент</th>
              <th>Изделие</th>
              <th>Тираж</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            {recentOrders.map(o => (
              <tr
                key={o.id}
                className="dash-order-row"
                onClick={() => { loadOrder(o); navigate('/print'); }}
              >
                <td className="sku-td-art">{o.order_number || '—'}</td>
                <td>{o.data?.name || '—'}</td>
                <td>{TYPE_NAMES[o.item_type] || TYPE_NAMES[(o.item_type || '').toLowerCase()] || o.item_type || '—'}</td>
                <td>{o.total_qty || 0}</td>
                <td className="sku-td-est">{(o.total_sum || 0).toLocaleString('ru-RU')} ₽</td>
                <td>
                  <span className="dash-status-badge" style={{ background: (STATUS_COLORS[o.status] || STATUS_COLORS.draft).bg, color: (STATUS_COLORS[o.status] || STATUS_COLORS.draft).text }}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </td>
                <td className="dash-date-cell">
                  {o.created_at ? new Date(o.created_at).toLocaleDateString('ru-RU') : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top SKU */}
      <div className={`analytics-section ${styles.sectionSpaced}`}>
        <div className="section-label">Топ артикулов</div>
        {topSku.length === 0 ? (
          <div className="empty-state">Нет данных за период</div>
        ) : (
          <table className={styles.skuTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>Артикул</th>
                <th className={styles.alignRight}>Кол-во</th>
                <th className={styles.alignRight}>Заказов</th>
                <th className={styles.alignRight}>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {topSku.map((s, i) => (
                <tr key={s.name}>
                  <td className={styles.idx}>{i + 1}</td>
                  <td className={i < 3 ? styles.nameTop : styles.name}>{s.name}</td>
                  <td className={styles.num}>{s.qty.toLocaleString('ru-RU')}</td>
                  <td className={styles.numDim}>{s.orders}</td>
                  <td className={styles.num}>
                    {s.sum > 0 ? s.sum.toLocaleString('ru-RU') + ' ₽' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ── Production Tab ── */
function ProductionTab({ orders }) {
  const productionOrders = useMemo(() => orders.filter(o => o.status === 'production'), [orders]);
  const approvedOrders = useMemo(() => orders.filter(o => o.status === 'approved'), [orders]);
  const activeOrders = useMemo(() => [...productionOrders, ...approvedOrders], [productionOrders, approvedOrders]);
  const totalActive = productionOrders.length + approvedOrders.length;

  const prodQty = productionOrders.reduce((s, o) => s + (o.total_qty || 0), 0);
  const apprQty = approvedOrders.reduce((s, o) => s + (o.total_qty || 0), 0);
  const prodPct = totalActive ? Math.round((productionOrders.length / totalActive) * 100) : 0;
  const apprPct = totalActive ? 100 - prodPct : 0;

  const typeData = useMemo(() => {
    const map = {};
    productionOrders.forEach(o => {
      const t = o.item_type || 'other';
      if (!map[t]) map[t] = { type: t, name: TYPE_NAMES[t] || TYPE_NAMES[t.toLowerCase()] || t, count: 0, qty: 0 };
      map[t].count++;
      map[t].qty += o.total_qty || 0;
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [productionOrders]);

  const deadlineOrders = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() + 14);
    return activeOrders
      .filter(o => o.data?.deadline)
      .filter(o => {
        const dl = new Date(o.data.deadline);
        return dl <= cutoff || dl < now;
      })
      .sort((a, b) => new Date(a.data.deadline) - new Date(b.data.deadline));
  }, [activeOrders]);

  const weeklyLoad = useMemo(() => {
    const map = {};
    activeOrders.forEach(o => {
      if (!o.data?.deadline) return;
      const week = getWeekLabel(o.data.deadline);
      if (!map[week]) map[week] = { week, qty: 0, count: 0 };
      map[week].qty += o.total_qty || 0;
      map[week].count++;
    });
    return Object.values(map).slice(0, 8);
  }, [activeOrders]);

  const typeChartData = {
    labels: typeData.map(d => d.name),
    datasets: [{
      data: typeData.map(d => d.qty),
      backgroundColor: typeData.map(d => CATEGORY_COLORS[d.type] || CATEGORY_COLORS[d.type.toLowerCase()] || '#888'),
      borderRadius: 2,
    }],
  };

  const weeklyChartData = {
    labels: weeklyLoad.map(d => d.week),
    datasets: [{
      data: weeklyLoad.map(d => d.qty),
      backgroundColor: '#1D19EA',
      borderRadius: 2,
    }],
  };

  return (
    <>
      <div className={`dash-chart-title ${styles.chartTitleSpaced}`}>Текущая загрузка</div>
      <div className="dash-load-row">
        <div className="dash-load-card">
          <div className="dash-metric-label">В ПРОИЗВОДСТВЕ</div>
          <div className={`dash-metric-value ${styles.prodValue}`}>{productionOrders.length} заказов</div>
          <div className="dash-load-sub">{prodQty.toLocaleString('ru-RU')} шт</div>
          <div className="dash-load-bar">
            <div className={`dash-load-fill ${styles.prodFill}`} style={{ width: prodPct + '%' }} />
          </div>
          <div className="dash-load-pct">{prodPct}%</div>
        </div>
        <div className="dash-load-card">
          <div className="dash-metric-label">ПОДТВЕРЖДЕНО</div>
          <div className={`dash-metric-value ${styles.apprValue}`}>{approvedOrders.length} заказов</div>
          <div className="dash-load-sub">{apprQty.toLocaleString('ru-RU')} шт</div>
          <div className="dash-load-bar">
            <div className={`dash-load-fill ${styles.apprFill}`} style={{ width: apprPct + '%' }} />
          </div>
          <div className="dash-load-pct">{apprPct}%</div>
        </div>
      </div>

      {typeData.length > 0 && (
        <div className="dash-chart">
          <div className="dash-chart-title">Разбивка по типу изделия (в производстве)</div>
          <div style={{ height: Math.max(150, typeData.length * 36) }}>
            <Bar data={typeChartData} options={{
              ...CHART_OPTS_BASE,
              indexAxis: 'y',
              plugins: { ...CHART_OPTS_BASE.plugins, tooltip: { callbacks: { label: ctx => ctx.parsed.x + ' шт' } } },
            }} />
          </div>
        </div>
      )}

      <div className="dash-chart">
        <div className="dash-chart-title">Дедлайны (ближайшие 14 дней)</div>
        {deadlineOrders.length === 0 ? (
          <div className="dash-empty">Нет заказов с дедлайнами</div>
        ) : (
          <div className="dash-deadline-list">
            {deadlineOrders.map(o => {
              const dl = o.data.deadline;
              const color = getDeadlineColor(dl);
              const label = getDeadlineLabel(dl);
              const dlDate = new Date(dl).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
              return (
                <div key={o.id} className="dash-deadline-row">
                  <span className="dash-dl-dot" style={{ background: color }} />
                  <span className="dash-dl-num">{o.order_number}</span>
                  <span className="dash-dl-name">{o.data?.name || '—'}</span>
                  <span className="dash-dl-qty">{o.total_qty || 0} шт</span>
                  <span className="dash-dl-date">{dlDate}</span>
                  <span className="dash-dl-badge" style={{ background: color }}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {weeklyLoad.length > 0 && (
        <div className="dash-chart">
          <div className="dash-chart-title">Нагрузка по неделям (прогноз)</div>
          <div style={{ height: 200 }}>
            <Bar data={weeklyChartData} options={{
              ...CHART_OPTS_BASE,
              plugins: { ...CHART_OPTS_BASE.plugins, tooltip: { callbacks: { label: ctx => ctx.parsed.y + ' шт' } } },
            }} />
          </div>
        </div>
      )}
    </>
  );
}

/* ── Main Dashboard ── */
export default function Dashboard() {
  const navigate = useNavigate();
  const { orders, fetchOrders, loading } = useOrdersStore(useShallow(s => ({ orders: s.orders, fetchOrders: s.fetchOrders, loading: s.loading })));
  const loadOrder = useStore(s => s.loadOrder);
  const [period, setPeriod] = useState(30);
  const [tab, setTab] = useState('analytics');

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  return (
    <div className="kanban-page">
      <PageHeader
        title="ДАШБОРД"
        tabs={[{ id: 'analytics', name: 'Аналитика' }, { id: 'production', name: 'Производство' }]}
        activeTab={tab}
        onTabChange={setTab}
      />

      <div className="dash-body-scroll">
        {loading && orders.length === 0 ? (
          <SkeletonTable rows={6} cols={5} />
        ) : !loading && orders.length === 0 ? (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
              <path d="M3 3v18h18" />
              <path d="M7 16l4-4 4 4 5-5" />
            </svg>
            <p>Нет данных за выбранный период</p>
            <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Создайте заказы чтобы увидеть аналитику</p>
          </div>
        ) : tab === 'analytics' ? (
          <AnalyticsTab orders={orders} period={period} setPeriod={setPeriod} navigate={navigate} loadOrder={loadOrder} />
        ) : (
          <ProductionTab orders={orders} />
        )}
      </div>
    </div>
  );
}
