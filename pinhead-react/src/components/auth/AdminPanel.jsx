import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { TYPE_NAMES } from '../../data';

const ALL_ROLES = ['admin', 'director', 'rop', 'manager', 'production', 'designer'];

export default function AdminPanel() {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [ordersRes, usersRes] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('*').order('name'),
    ]);
    if (ordersRes.data) setOrders(ordersRes.data);
    if (usersRes.data) setUsers(usersRes.data);
    setLoading(false);
  };

  const approveUser = async (id) => {
    await supabase.from('profiles').update({ approved: true }).eq('id', id);
    setUsers(u => u.map(x => x.id === id ? { ...x, approved: true } : x));
  };

  const changeRole = async (id, newRole) => {
    await supabase.from('profiles').update({ role: newRole }).eq('id', id);
    setUsers(u => u.map(x => x.id === id ? { ...x, role: newRole } : x));
  };

  const deleteUser = async (id) => {
    if (!confirm('Удалить пользователя?')) return;
    await supabase.from('profiles').delete().eq('id', id);
    setUsers(u => u.filter(x => x.id !== id));
  };

  const changeOrderStatus = async (id, status) => {
    await supabase.from('orders').update({ status }).eq('id', id);
    setOrders(o => o.map(x => x.id === id ? { ...x, status } : x));
  };

  const deleteOrder = async (id) => {
    if (!confirm('Удалить заказ?')) return;
    await supabase.from('orders').delete().eq('id', id);
    setOrders(o => o.filter(x => x.id !== id));
  };

  // Filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;
    if (statusFilter !== 'all') result = result.filter(o => o.status === statusFilter);
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toLowerCase();
      result = result.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.data?.name || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [orders, statusFilter, orderSearch]);

  const totalRevenue = orders.reduce((s, o) => s + (o.total_sum || 0), 0);

  // Stats for third tab
  const stats = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = new Date(today); week.setDate(week.getDate() - 7);
    const month = new Date(today); month.setDate(month.getDate() - 30);

    const ordersToday = orders.filter(o => new Date(o.created_at) >= today).length;
    const ordersWeek = orders.filter(o => new Date(o.created_at) >= week).length;
    const ordersMonth = orders.filter(o => new Date(o.created_at) >= month).length;
    const revenueMonth = orders.filter(o => new Date(o.created_at) >= month).reduce((s, o) => s + (o.total_sum || 0), 0);

    // Top 3 managers by order count (last 30 days)
    const monthOrders = orders.filter(o => new Date(o.created_at) >= month);
    const managerMap = {};
    monthOrders.forEach(o => {
      const name = o.data?.name || 'Неизвестный';
      if (!managerMap[name]) managerMap[name] = { name, count: 0 };
      managerMap[name].count++;
    });
    const topManagers = Object.values(managerMap).sort((a, b) => b.count - a.count).slice(0, 3);

    return {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.approved).length,
      ordersToday, ordersWeek, ordersMonth, revenueMonth, topManagers,
    };
  }, [orders, users]);

  return (
    <div className="kanban-page">
      {/* Header */}
      <div className="sku-ed-header">
        <div className="sku-ed-header-left">
          <h1 className="sku-ed-title">Админ-панель</h1>
          <span style={{ fontSize: 11, background: '#fff3cd', color: '#856404', padding: '2px 8px', fontWeight: 700 }}>
            {orders.length} заказов · {totalRevenue.toLocaleString('ru-RU')} ₽
          </span>
        </div>
        <div className="sku-ed-header-right">
          <button className="btn" onClick={loadData}>Обновить</button>
          <button className="pe-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="page-tabs">
        <button className={`page-tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>Заказы</button>
        <button className={`page-tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>Пользователи</button>
        <button className={`page-tab${tab === 'stats' ? ' active' : ''}`} onClick={() => setTab('stats')}>Статистика</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 40px 40px' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 13 }}>Загрузка...</div>
        ) : tab === 'orders' ? (
          <>
            {/* Search + Filter */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="kb-search"
                placeholder="Поиск по номеру или клиенту..."
                value={orderSearch}
                onChange={e => setOrderSearch(e.target.value)}
                style={{ width: 260 }}
              />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{
                  border: '1.5px solid #ccc', padding: '6px 12px',
                  fontFamily: "'Roboto Condensed', sans-serif", fontSize: 12,
                }}
              >
                <option value="all">Все статусы</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
                Показано: {filteredOrders.length} из {orders.length}
              </span>
            </div>

            <table className="sku-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Клиент</th>
                  <th>Изделие</th>
                  <th>Кол-во</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th>Дата</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(o => (
                  <tr key={o.id}>
                    <td className="sku-code">{o.order_number || '—'}</td>
                    <td>{o.data?.name || '—'}</td>
                    <td>{TYPE_NAMES[o.item_type] || TYPE_NAMES[(o.item_type || '').toLowerCase()] || o.item_type || '—'}</td>
                    <td>{o.total_qty || 0}</td>
                    <td className="sku-price">{(o.total_sum || 0).toLocaleString('ru-RU')} ₽</td>
                    <td>
                      <select
                        value={o.status || 'draft'}
                        onChange={e => changeOrderStatus(o.id, e.target.value)}
                        style={{ borderColor: STATUS_COLORS[o.status] || '#888', fontWeight: 600, fontSize: 11 }}
                      >
                        {Object.entries(STATUS_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ fontSize: 11, color: '#888' }}>
                      {o.created_at ? new Date(o.created_at).toLocaleDateString('ru-RU') : ''}
                    </td>
                    <td>
                      <button className="sku-del-btn" onClick={() => deleteOrder(o.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : tab === 'users' ? (
          <table className="sku-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name || '—'}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.role || 'manager'}
                      onChange={e => changeRole(u.id, e.target.value)}
                      style={{
                        border: '1.5px solid #ccc', padding: '2px 8px',
                        fontFamily: "'Roboto Condensed', sans-serif", fontSize: 11, fontWeight: 600,
                        background: u.role === 'admin' ? '#1D19EA' : 'transparent',
                        color: u.role === 'admin' ? '#fff' : '#000',
                      }}
                    >
                      {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    {u.approved ? (
                      <span style={{ color: '#007840', fontWeight: 600, fontSize: 11 }}>Активен</span>
                    ) : (
                      <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 10 }} onClick={() => approveUser(u.id)}>
                        Одобрить
                      </button>
                    )}
                  </td>
                  <td>
                    <button className="sku-del-btn" onClick={() => deleteUser(u.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* Stats tab */
          <div style={{ maxWidth: 600 }}>
            <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 24 }}>
              <div className="dash-metric">
                <div className="dash-metric-label">Пользователей</div>
                <div className="dash-metric-value">
                  {stats.totalUsers}
                  <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>({stats.activeUsers} акт.)</span>
                </div>
              </div>
              <div className="dash-metric">
                <div className="dash-metric-label">Выручка за 30 дн</div>
                <div className="dash-metric-value" style={{ color: '#1D19EA' }}>{stats.revenueMonth.toLocaleString('ru-RU')} ₽</div>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#888', marginBottom: 12 }}>
                Заказы
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { label: 'Сегодня', value: stats.ordersToday },
                  { label: '7 дней', value: stats.ordersWeek },
                  { label: '30 дней', value: stats.ordersMonth },
                ].map(item => (
                  <div key={item.label} style={{ flex: 1, padding: 16, border: '1.5px solid #ccc', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>
                      {item.label}
                    </div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 900 }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#888', marginBottom: 12 }}>
                Топ-3 менеджера (30 дней)
              </div>
              {stats.topManagers.length === 0 ? (
                <div style={{ color: '#888', fontSize: 13 }}>Нет данных</div>
              ) : (
                stats.topManagers.map((m, i) => (
                  <div key={m.name} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    borderBottom: '1px solid #eee',
                  }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: i === 0 ? '#1D19EA' : i === 1 ? '#444' : '#888',
                      color: '#fff', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 16 }}>
                      {m.count} заказов
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
