import { useState, useEffect, useMemo, useCallback } from 'react';
import PageHeader from '../shared/PageHeader';
import { supabase } from '../../lib/supabase';
import { useOrdersStore, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useShallow } from 'zustand/react/shallow';
import { TYPE_NAMES } from '../../data';
import { ROLE_LABELS, ALL_ROLES } from '../../data/roles';
import { toast } from '../../store/useToastStore';
import { confirm } from '../../store/useConfirmStore';
import { pluralize } from '../../utils/i18n';
import { SkeletonTable } from '../shared/Skeleton';

export default function AdminPanel() {
  const [tab, setTab] = useState('orders');

  // Orders from store (shared with KanbanBoard/Dashboard)
  const { orders, fetchOrders, updateStatus, deleteOrder: storeDeleteOrder } = useOrdersStore(
    useShallow(s => ({ orders: s.orders, fetchOrders: s.fetchOrders, updateStatus: s.updateStatus, deleteOrder: s.deleteOrder }))
  );

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
    const { error } = await supabase.from('profiles').update({ approved: true }).eq('id', id);
    if (error) { toast.error('Не удалось подтвердить пользователя'); return; }
    setUsers(u => u.map(x => x.id === id ? { ...x, approved: true } : x));
  };

  const changeRole = async (id, newRole) => {
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
    if (error) { toast.error('Не удалось изменить роль'); return; }
    setUsers(u => u.map(x => x.id === id ? { ...x, role: newRole } : x));
  };

  const deactivateUser = async (id) => {
    const ok = await confirm({ title: 'Деактивировать пользователя?', confirmLabel: 'Деактивировать', variant: 'danger' });
    if (!ok) return;
    const { error } = await supabase.from('profiles').update({ active: false, approved: false }).eq('id', id);
    if (error) { toast.error('Не удалось деактивировать пользователя'); return; }
    setUsers(u => u.map(x => x.id === id ? { ...x, active: false, approved: false } : x));
  };

  const reactivateUser = async (id) => {
    const { error } = await supabase.from('profiles').update({ active: true }).eq('id', id);
    if (error) { toast.error('Не удалось активировать пользователя'); return; }
    setUsers(u => u.map(x => x.id === id ? { ...x, active: true } : x));
  };

  const handleDeleteOrder = async (id) => {
    const ok = await confirm({ title: 'Удалить заказ?', confirmLabel: 'Удалить', variant: 'danger' });
    if (!ok) return;
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
      <PageHeader
        title="АДМИН-ПАНЕЛЬ"
        badge={`${orders.length} ${pluralize(orders.length, 'заказ', 'заказа', 'заказов')} · ${totalRevenue.toLocaleString('ru-RU')} ₽`}
        actions={<button className="btn" onClick={() => { fetchOrders(); loadUsers(); }}>Обновить</button>}
        tabs={[{ id: 'orders', name: 'Заказы' }, { id: 'users', name: 'Пользователи' }]}
        activeTab={tab}
        onTabChange={setTab}
      />

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
                {filteredOrders.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 13 }}>
                    {orderSearch || statusFilter !== 'all' ? 'Ничего не найдено' : (
                      <div className="empty-state">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M9 9h6M9 13h4" />
                        </svg>
                        <p>Заказов пока нет</p>
                      </div>
                    )}
                  </td></tr>
                )}
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
                        style={{ borderColor: (STATUS_COLORS[o.status] || STATUS_COLORS.draft).bar, fontWeight: 600, fontSize: 11 }}
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
                      <button className="sku-del-btn" onClick={() => handleDeleteOrder(o.id)} aria-label="Удалить заказ">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : loading ? (
          <SkeletonTable rows={5} cols={5} />
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
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: '#888', fontSize: 13 }}>
                  Пользователей нет
                </td></tr>
              )}
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
                      {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                    </select>
                  </td>
                  <td>
                    {u.active === false ? (
                      <span style={{ color: '#999', fontWeight: 600, fontSize: 11 }}>Деактивирован</span>
                    ) : u.approved ? (
                      <span style={{ color: '#007840', fontWeight: 600, fontSize: 11 }}>Активен</span>
                    ) : (
                      <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 10 }} onClick={() => approveUser(u.id)}>
                        Одобрить
                      </button>
                    )}
                  </td>
                  <td>
                    {u.active === false ? (
                      <button className="btn" style={{ padding: '3px 10px', fontSize: 10 }} onClick={() => reactivateUser(u.id)}>
                        Активировать
                      </button>
                    ) : (
                      <button className="sku-del-btn" onClick={() => deactivateUser(u.id)} aria-label="Деактивировать пользователя">✕</button>
                    )}
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
