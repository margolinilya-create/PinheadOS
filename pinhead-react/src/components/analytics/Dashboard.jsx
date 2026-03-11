import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES } from '../../data';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from 'recharts';

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

function groupByType(orders) {
  const map = {};
  orders.forEach(o => {
    const t = o.item_type || 'other';
    if (!map[t]) map[t] = { type: t, name: TYPE_NAMES[t] || TYPE_NAMES[t.toLowerCase()] || t, count: 0, qty: 0 };
    map[t].count++;
    map[t].qty += o.total_qty || 0;
  });
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8);
}

function groupByStatus(orders) {
  const map = {};
  orders.forEach(o => {
    const s = o.status || 'draft';
    if (!map[s]) map[s] = { status: s, name: STATUS_LABELS[s] || s, value: 0, color: STATUS_COLORS[s] || '#888' };
    map[s].value += o.total_sum || 0;
  });
  return Object.values(map).filter(d => d.value > 0);
}

function groupByManager(orders) {
  const map = {};
  orders.forEach(o => {
    const name = o.data?.name || 'Неизвестный';
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

function getDeadlineColor(deadline) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dl = new Date(deadline); dl.setHours(0, 0, 0, 0);
  const diff = Math.ceil((dl - now) / 86400000);
  if (diff < 0) return '#e53e3e';
  if (diff <= 3) return '#c04500';
  if (diff <= 7) return '#b89000';
  return '#007840';
}

function getDeadlineLabel(deadline) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dl = new Date(deadline); dl.setHours(0, 0, 0, 0);
  const diff = Math.ceil((dl - now) / 86400000);
  if (diff < 0) return 'ПРОСРОЧЕН';
  return `${diff} дн`;
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
  const typeData = useMemo(() => groupByType(filtered), [filtered]);
  const statusData = useMemo(() => groupByStatus(filtered), [filtered]);
  const managerData = useMemo(() => groupByManager(filtered), [filtered]);
  const recentOrders = useMemo(() =>
    [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10),
    [filtered]
  );

  return (
    <>
      {/* Period + Export */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="dash-period">
          {PERIODS.map(p => (
            <button key={p.key} className={`dash-period-btn${period === p.key ? ' active' : ''}`} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => exportCSV(filtered)}>Экспорт CSV</button>
      </div>

      {/* 6 Metrics */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
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
          <div className="dash-metric-value" style={{ color: '#007840' }}>{conversion}%</div>
        </div>
        <div className="dash-metric">
          <div className="dash-metric-label">В работе</div>
          <div className="dash-metric-value">{inWork.length} <span style={{ fontSize: 12, color: '#888' }}>({inWorkQty} шт)</span></div>
        </div>
      </div>

      {/* Chart: Revenue by week (AreaChart) */}
      <div className="dash-chart">
        <div className="dash-chart-title">Выручка по неделям</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={weeklyData}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1D19EA" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#1D19EA" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="week" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={v => v.toLocaleString('ru-RU') + ' ₽'} />
            <Area type="monotone" dataKey="sum" stroke="#1D19EA" fill="url(#areaGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="dash-row">
        {/* Top managers */}
        <div className="dash-chart dash-chart-half">
          <div className="dash-chart-title">Топ менеджеры по выручке</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={managerData} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
              <Tooltip formatter={v => v.toLocaleString('ru-RU') + ' ₽'} />
              <Bar dataKey="sum" fill="#1D19EA" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue by status */}
        <div className="dash-chart dash-chart-half">
          <div className="dash-chart-title">Выручка по статусам</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name }) => name}>
                {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={v => v.toLocaleString('ru-RU') + ' ₽'} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent orders table */}
      <div className="dash-chart">
        <div className="dash-chart-title">Последние заказы</div>
        <table className="sku-table">
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
                style={{ cursor: 'pointer' }}
                onClick={() => { loadOrder(o); navigate('/print'); }}
              >
                <td className="sku-code">{o.order_number || '—'}</td>
                <td>{o.data?.name || '—'}</td>
                <td>{TYPE_NAMES[o.item_type] || TYPE_NAMES[(o.item_type || '').toLowerCase()] || o.item_type || '—'}</td>
                <td>{o.total_qty || 0}</td>
                <td className="sku-price">{(o.total_sum || 0).toLocaleString('ru-RU')} ₽</td>
                <td>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px',
                    background: STATUS_COLORS[o.status] || '#888', color: '#fff',
                  }}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: '#888' }}>
                  {o.created_at ? new Date(o.created_at).toLocaleDateString('ru-RU') : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

  // Type breakdown (production only)
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

  // Deadlines (next 14 days)
  const deadlineOrders = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() + 14);
    return activeOrders
      .filter(o => o.data?.deadline)
      .filter(o => {
        const dl = new Date(o.data.deadline);
        return dl <= cutoff || dl < now; // include overdue
      })
      .sort((a, b) => new Date(a.data.deadline) - new Date(b.data.deadline));
  }, [activeOrders]);

  // Weekly load forecast
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

  const metricBlock = { flex: 1, padding: 20, border: '1.5px solid #ccc', textAlign: 'center' };

  return (
    <>
      {/* Section A: Current load */}
      <div className="dash-chart-title" style={{ marginBottom: 12 }}>Текущая загрузка</div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <div style={metricBlock}>
          <div className="dash-metric-label">В ПРОИЗВОДСТВЕ</div>
          <div className="dash-metric-value" style={{ color: '#c04500' }}>{productionOrders.length} заказов</div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>{prodQty.toLocaleString('ru-RU')} шт</div>
          <div style={{ height: 4, background: '#eee', width: '100%' }}>
            <div style={{ height: 4, background: '#c04500', width: prodPct + '%', transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{prodPct}%</div>
        </div>
        <div style={metricBlock}>
          <div className="dash-metric-label">ПОДТВЕРЖДЕНО</div>
          <div className="dash-metric-value" style={{ color: '#1D19EA' }}>{approvedOrders.length} заказов</div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>{apprQty.toLocaleString('ru-RU')} шт</div>
          <div style={{ height: 4, background: '#eee', width: '100%' }}>
            <div style={{ height: 4, background: '#1D19EA', width: apprPct + '%', transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{apprPct}%</div>
        </div>
      </div>

      {/* Section B: By item type */}
      {typeData.length > 0 && (
        <div className="dash-chart">
          <div className="dash-chart-title">Разбивка по типу изделия (в производстве)</div>
          <ResponsiveContainer width="100%" height={Math.max(150, typeData.length * 36)}>
            <BarChart data={typeData} layout="vertical">
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
              <Tooltip formatter={(v, name) => [v, name === 'qty' ? 'шт' : 'заказов']} />
              <Bar dataKey="qty" radius={[0, 2, 2, 0]}>
                {typeData.map((d, i) => (
                  <Cell key={i} fill={CATEGORY_COLORS[d.type] || CATEGORY_COLORS[d.type.toLowerCase()] || '#888'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Section C: Deadlines */}
      <div className="dash-chart">
        <div className="dash-chart-title">Дедлайны (ближайшие 14 дней)</div>
        {deadlineOrders.length === 0 ? (
          <div style={{ padding: 20, color: '#888', fontSize: 13 }}>Нет заказов с дедлайнами</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {deadlineOrders.map(o => {
              const dl = o.data.deadline;
              const color = getDeadlineColor(dl);
              const label = getDeadlineLabel(dl);
              const dlDate = new Date(dl).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
              return (
                <div key={o.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderBottom: '1px solid #eee', fontSize: 13,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", color: '#1D19EA', minWidth: 60 }}>
                    {o.order_number}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.data?.name || '—'}
                  </span>
                  <span style={{ fontWeight: 600, minWidth: 50 }}>{o.total_qty || 0} шт</span>
                  <span style={{ color: '#888', minWidth: 50 }}>{dlDate}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px',
                    background: color, color: color === '#007840' ? '#fff' : '#fff',
                    minWidth: 55, textAlign: 'center',
                  }}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section D: Weekly load forecast */}
      {weeklyLoad.length > 0 && (
        <div className="dash-chart">
          <div className="dash-chart-title">Нагрузка по неделям (прогноз)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyLoad}>
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v, name) => [v, name === 'qty' ? 'шт' : 'заказов']} />
              <Bar dataKey="qty" fill="#1D19EA" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}

/* ── Main Dashboard ── */
export default function Dashboard() {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const orders = useOrdersStore(s => s.orders);
  const fetchOrders = useOrdersStore(s => s.fetchOrders);
  const loadOrder = useStore(s => s.loadOrder);
  const [period, setPeriod] = useState(30);
  const [tab, setTab] = useState('analytics');

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  return (
    <div className="kanban-page">
      {/* Header */}
      <div className="sku-ed-header">
        <div className="sku-ed-header-left">
          <h1 className="sku-ed-title">ДАШБОРД</h1>
        </div>
        <div className="sku-ed-header-right">
          <button className="pe-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="page-tabs">
        <button className={`page-tab${tab === 'analytics' ? ' active' : ''}`} onClick={() => setTab('analytics')}>
          Аналитика
        </button>
        <button className={`page-tab${tab === 'production' ? ' active' : ''}`} onClick={() => setTab('production')}>
          Производство
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 40px 40px' }}>
        {tab === 'analytics' ? (
          <AnalyticsTab orders={orders} period={period} setPeriod={setPeriod} navigate={navigate} loadOrder={loadOrder} />
        ) : (
          <ProductionTab orders={orders} />
        )}
      </div>
    </div>
  );
}
