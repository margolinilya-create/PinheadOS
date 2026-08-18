import { useState, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOrdersStore, STATUS_LABELS } from '../../store/useOrdersStore';
import { TYPE_NAMES } from '../../data';
import { confirm } from '../../store/useConfirmStore';
import { pluralize } from '../../utils/i18n';
import { Button } from '../../erp/components/Button';
import { EmptyResult, EmptyState } from '../../erp/components/ErpStates';
import { ScrollHintBox } from '../../erp/components/ScrollHintBox';
import { TableSkeleton } from '../../erp/components/ErpSkeletons';
import styles from '../../erp/erp.module.css';

/**
 * Таблица заказов Order Studio — вкладка «Заказы ТЗ» единой админки ERP.
 *
 * ЧТО ЗДЕСЬ БЫЛО. Компонент нёс вторую половину — вкладку «Пользователи»
 * с прямой правкой `profiles.role`, одобрением и деактивацией. Достижима она
 * была только при `ordersOnly === false`, а таких вызовов в проекте нет
 * НИ ОДНОГО: `AdminScreen` монтирует эту панель всегда с `ordersOnly`.
 * То есть в коде жила вторая, более слабая реализация управления учётками —
 * мимо `erp_employees`, приглашений, матрицы прав и серверной функции
 * `admin-users`. Настоящая живёт в `EmployeesScreen`, и расхождение двух
 * реализаций одних и тех же правил в этом проекте уже давало отказы вида
 * «кнопка есть, действие падает». Половина удалена вместе с пропом.
 *
 * Вид приведён к языку ERP (примитивы `Button`, классы `erp.module.css`):
 * панель смонтирована ВНУТРИ админки ERP, и глобальные `btn`/`sku-table`
 * из Order Studio выглядели здесь чужой вставкой.
 *
 * Шапку раздела рисует сама `AdminScreen` — второй заголовок тут не нужен.
 */
export default function AdminPanel() {
  const { orders, loading, fetchOrders, updateStatus, deleteOrder } = useOrdersStore(
    useShallow((s) => ({
      orders: s.orders,
      loading: s.loading,
      fetchOrders: s.fetchOrders,
      updateStatus: s.updateStatus,
      deleteOrder: s.deleteOrder,
    })),
  );

  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleDeleteOrder = async (id) => {
    const ok = await confirm({ title: 'Удалить заказ?', confirmLabel: 'Удалить', variant: 'danger' });
    if (!ok) return;
    deleteOrder(id);
  };

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (statusFilter !== 'all') result = result.filter((o) => o.status === statusFilter);
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toLowerCase();
      result = result.filter((o) =>
        (o.order_number || '').toLowerCase().includes(q)
        || (o.data?.name || '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [orders, statusFilter, orderSearch]);

  const totalRevenue = orders.reduce((s, o) => s + (o.total_sum || 0), 0);
  const filtered = statusFilter !== 'all' || orderSearch.trim() !== '';

  const resetFilters = () => { setStatusFilter('all'); setOrderSearch(''); };

  return (
    <>
      <div className={styles.filterBar}>
        <input
          className={`${styles.input} ${styles.searchInput}`}
          placeholder="Поиск по номеру или клиенту..."
          aria-label="Поиск заказов ТЗ"
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
        />
        <select
          className={styles.select}
          aria-label="Статус заказа"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <Button variant="ghost" icon="refresh" onClick={() => fetchOrders()}>Обновить</Button>
        <span className={styles.subText}>
          {orders.length} {pluralize(orders.length, 'заказ', 'заказа', 'заказов')}
          {' · '}{totalRevenue.toLocaleString('ru-RU')} ₽
          {filtered && ` · показано ${filteredOrders.length}`}
        </span>
      </div>

      {loading && orders.length === 0 ? (
        <TableSkeleton rows={5} label="Загрузка заказов ТЗ" />
      ) : filteredOrders.length === 0 ? (
        filtered
          ? <EmptyResult query={orderSearch} onReset={resetFilters} />
          : <EmptyState icon="inbox" title="Заказов ТЗ пока нет" text="Оформленные в визарде заказы появятся здесь." />
      ) : (
        <ScrollHintBox>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Клиент</th>
                <th>Изделие</th>
                <th>Кол-во</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Дата</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => (
                <tr key={o.id}>
                  <td>{o.order_number || '—'}</td>
                  <td>{o.data?.name || '—'}</td>
                  <td>
                    {TYPE_NAMES[o.item_type]
                      || TYPE_NAMES[(o.item_type || '').toLowerCase()]
                      || o.item_type || '—'}
                  </td>
                  <td>{o.total_qty || 0}</td>
                  <td>{(o.total_sum || 0).toLocaleString('ru-RU')} ₽</td>
                  <td>
                    <select
                      className={styles.select}
                      aria-label={`Статус заказа ${o.order_number || ''}`}
                      value={o.status || 'draft'}
                      onChange={(e) => updateStatus(o.id, e.target.value)}
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </td>
                  <td className={styles.subText}>
                    {o.created_at ? new Date(o.created_at).toLocaleDateString('ru-RU') : ''}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      iconOnly
                      aria-label={`Удалить заказ ${o.order_number || ''}`}
                      onClick={() => handleDeleteOrder(o.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </>
  );
}
