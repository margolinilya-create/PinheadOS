import { useState, useMemo } from 'react';
import { useOrdersStore, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { TYPE_NAMES } from '../../data';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const PERIODS = [
  { key: 7, label: '7 дней' },
  { key: 30, label: '30 дней' },
  { key: 90, label: '90 дней' },
  { key: 0, label: 'Всё' },
];

function filterByPeriod(orders, days) {
  if (!days) return orders;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return orders.filter(o => new Date(o.created_at) >= cutoff);
}

function groupByDay(orders) {
  const map = {};
  orders.forEach(o => {
    const day = new Date(o.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    if (!map[day]) map[day] = { day, count: 0, sum: 0 };
    map[day].count++;
    map[day].sum += o.total_sum || 0;
  });
  return Object.values(map).slice(-30);
}

function groupByType(orders) {
  const map = {};
  orders.forEach(o => {
    const t = o.item_type || 'other';
    if (!map[t]) map[t] = { type: t, name: TYPE_NAMES[t] || t, count: 0 };
    map[t].count++;
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

export default function Dashboard({ onClose }) {
  const orders = useOrdersStore(s => s.orders);
  const [period, setPeriod] = useState(30);

  const filtered = useMemo(() => filterByPeriod(orders, period), [orders, period]);
  const totalSum = filtered.reduce((s, o) => s + (o.total_sum || 0), 0);
  const totalQty = filtered.reduce((s, o) => s + (o.total_qty || 0), 0);
  const avgCheck = filtered.length ? Math.round(totalSum / filtered.length) : 0;
  const avgQty = filtered.length ? Math.round(totalQty / filtered.length) : 0;

  const dailyData = useMemo(() => groupByDay(filtered), [filtered]);
  const typeData = useMemo(() => groupByType(filtered), [filtered]);
  const statusData = useMemo(() => groupByStatus(filtered), [filtered]);

  return (
    <div className="dash-overlay" onClick={onClose}>
      <div className="dash-panel" onClick={e => e.stopPropagation()}>
        <div className="dash-header">
          <h2 className="dash-title">Аналитика</h2>
          <div className="dash-period">
            {PERIODS.map(p => (
              <button key={p.key} className={`dash-period-btn${period === p.key ? ' active' : ''}`} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="dash-actions">
            <button className="btn" onClick={() => exportCSV(filtered)}>Экспорт CSV</button>
            <button className="dash-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="dash-body">
          {/* Metric Cards */}
          <div className="dash-metrics">
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
          </div>

          {/* Chart 1: Orders per day */}
          <div className="dash-chart">
            <div className="dash-chart-title">Заказы по дням</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyData}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v, name) => [v, name === 'count' ? 'Заказов' : 'Сумма']} />
                <Bar dataKey="count" fill="#000" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="dash-row">
            {/* Chart 2: Top items */}
            <div className="dash-chart dash-chart-half">
              <div className="dash-chart-title">Топ изделий</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={typeData} layout="vertical">
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#1D19EA" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 3: Revenue by status */}
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
        </div>
      </div>
    </div>
  );
}
