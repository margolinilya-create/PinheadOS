import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useOrdersStore, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { TYPE_NAMES } from '../../data';

const ALL_ROLES = ['admin', 'director', 'rop', 'manager', 'production', 'designer'];

export default function AdminPanel() {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const [tab, setTab] = useState('orders');

  // Orders from store (shared with KanbanBoard/Dashboard)
  const { orders, fetchOrders, updateStatus, deleteOrder: storeDeleteOrder } = useOrdersStore();

  // Users — direct Supabase (no store needed, admin-only)
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('name');
    if (data) setUsers(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch is intended
    loadUsers();
  }, [fetchOrders, loadUsers]);

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

  const handleDeleteOrder = (id) => {
    if (!confirm('Удалить заказ?')) return;
    storeDeleteOrder(id);
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
          <button className="btn" onClick={() => { fetchOrders(); loadUsers(); }}>Обновить</button>
          <button className="pe-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="page-tabs">
        <button className={`page-tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>Заказы</button>
        <button className={`page-tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>Пользователи</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 40px 40px' }}>
        {tab === 'orders' ? (
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
                        onChange={e => updateStatus(o.id, e.target.value)}
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
                      <button className="sku-del-btn" onClick={() => handleDeleteOrder(o.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 13 }}>Загрузка...</div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
