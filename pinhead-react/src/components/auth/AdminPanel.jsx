import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';

export default function AdminPanel({ onClose }) {
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

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

  const toggleRole = async (id, current) => {
    const newRole = current === 'admin' ? 'manager' : 'admin';
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

  // Stats
  const totalRevenue = orders.reduce((s, o) => s + (o.total_sum || 0), 0);

  return (
    <div className="pe-overlay">
      <div className="pe-panel">
        <div className="pe-header">
          <div className="pe-header-left">
            <span className="pe-title">Админ-панель</span>
            <span className="pe-changed">{orders.length} заказов · {totalRevenue.toLocaleString('ru-RU')} ₽</span>
          </div>
          <div className="pe-header-right">
            <button className="btn-secondary" onClick={loadData}>Обновить</button>
            <button className="pe-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="pe-tabs">
          <button className={`pe-tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>Заказы</button>
          <button className={`pe-tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>Пользователи</button>
        </div>

        <div className="pe-body">
          {loading ? (
            <div className="pe-empty">Загрузка...</div>
          ) : tab === 'orders' ? (
            <div className="pe-section">
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
                  {orders.map(o => (
                    <tr key={o.id}>
                      <td className="sku-code">{o.order_number || '—'}</td>
                      <td>{o.data?.name || '—'}</td>
                      <td>{o.item_type || '—'}</td>
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
                        <button className="kb-card-btn" style={{ color: '#c00' }} onClick={() => deleteOrder(o.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="pe-section">
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
                        <button
                          className={`sku-zone-tag${u.role === 'admin' ? ' admin' : ''}`}
                          onClick={() => toggleRole(u.id, u.role)}
                          title="Клик — переключить роль"
                        >
                          {u.role || 'manager'}
                        </button>
                      </td>
                      <td>
                        {u.approved ? (
                          <span style={{ color: '#007840', fontWeight: 600, fontSize: 11 }}>Активен</span>
                        ) : (
                          <button className="btn-accent" style={{ padding: '3px 10px', fontSize: 10 }} onClick={() => approveUser(u.id)}>
                            Одобрить
                          </button>
                        )}
                      </td>
                      <td>
                        <button className="kb-card-btn" style={{ color: '#c00' }} onClick={() => deleteUser(u.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
