import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOrdersStore, STATUS_LABELS } from '../../store/useOrdersStore';
import { TYPE_NAMES } from '../../data';
import { pluralize } from '../../utils/i18n';
import { Button } from '../../erp/components/Button';
import { SearchInput } from '../../erp/components/SearchInput';
import { SortableTh } from '../../erp/components/SortableTh';
import { ScrollHintBox } from '../../erp/components/ScrollHintBox';
import { EmptyResult, EmptyState, LoadFailed } from '../../erp/components/ErpStates';
import { TableSkeleton } from '../../erp/components/ErpSkeletons';
import erp from '../../erp/erp.module.css';
import styles from './AdminPanel.module.css';

/**
 * «Заказы ТЗ» в админке Производства (`erp/screens/AdminScreen`, вкладка `studio`):
 * старые заказы визарда (v3) — ТОЛЬКО ПРОСМОТР (веха 8, К4/К6). Запись v3 закрыта
 * стражем миграции L, поэтому кнопок правки статуса и удаления нет.
 *
 * На примитивах ERP и своём CSS-модуле: прежде панель тянула шесть глобальных
 * файлов Order Studio (`forms-buttons`, `wizard`, `extras-zones`, `kanban`,
 * `editors`, `responsive`), и их правила оставались в документе для экранов ERP,
 * открытых после `/admin`. Заголовок страницы (`h1`) и вкладки даёт принимающий
 * экран — здесь свой `h2` (второй `h1` и смена `document.title` внутри вкладки
 * были бы лишними). Ветка «Пользователи» удалена: учётные записи ведёт
 * вкладка «Пользователи» админки ERP. Проп `ordersOnly` (его передаёт
 * замороженный `AdminScreen`) больше ничего не меняет.
 */

const STATUS_OPTIONS = Object.entries(STATUS_LABELS);
const NO_SORT = { key: null, dir: null };

/** Следующая сортировка по колонке: по возрастанию → по убыванию → без сортировки */
function nextSort(sort, key) {
  if (sort.key !== key) return { key, dir: 'asc' };
  return sort.dir === 'asc' ? { key, dir: 'desc' } : NO_SORT;
}

const productOf = (o) => TYPE_NAMES[o.item_type] || TYPE_NAMES[(o.item_type || '').toLowerCase()] || o.item_type || '—';
const rub = (n) => `${(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '');

const SORT_VALUE = {
  number: (o) => o.order_number || '',
  customer: (o) => o.data?.name || '',
  qty: (o) => Number(o.total_qty) || 0,
  sum: (o) => Number(o.total_sum) || 0,
  date: (o) => o.created_at || '',
};

function sorted(rows, sort) {
  const value = SORT_VALUE[sort.key];
  if (!value) return rows;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (typeof x === 'number' && typeof y === 'number') return sign * (x - y);
    return sign * String(x).localeCompare(String(y), 'ru');
  });
}

export default function AdminPanel() {
  const { orders, loading, loadError, fetchOrders } = useOrdersStore(
    useShallow((s) => ({ orders: s.orders, loading: s.loading, loadError: s.loadError, fetchOrders: s.fetchOrders })),
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState(NO_SORT);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = orders.filter((o) => (status === 'all' || o.status === status)
      && (!q || (o.order_number || '').toLowerCase().includes(q) || (o.data?.name || '').toLowerCase().includes(q)));
    return sorted(rows, sort);
  }, [orders, search, status, sort]);

  const total = orders.reduce((s, o) => s + (Number(o.total_sum) || 0), 0);
  const reset = () => { setSearch(''); setStatus('all'); };
  const th = (key, label) => (
    <SortableTh sortKey={key} sort={sort} onSort={(k) => setSort((prev) => nextSort(prev, k))}>{label}</SortableTh>
  );

  return (
    <section className={styles.panel} aria-labelledby="v3-orders-head">
      <div className={styles.head}>
        <h2 id="v3-orders-head" className={styles.title}>Старые заказы — только просмотр</h2>
        <p className={styles.sub}>
          Заказы, оформленные до раздела «Оформление заказа». Изменить, сменить статус или удалить их нельзя —
          новый заказ заводится в разделе «Оформление заказа».
        </p>
      </div>

      <div className={styles.toolbar}>
        <SearchInput value={search} onChange={setSearch} placeholder="Номер или клиент" ariaLabel="Поиск по номеру или клиенту" />
        <label className={styles.filter}>
          Статус
          <select className={erp.select} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Все статусы</option>
            {STATUS_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <Button variant="secondary" icon="refresh" onClick={() => fetchOrders()}>Обновить</Button>
        {orders.length > 0 && (
          <span className={styles.count}>
            Показано: {filtered.length} из {orders.length} {pluralize(orders.length, 'заказа', 'заказов', 'заказов')} · {rub(total)}
          </span>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={5} label="Загрузка старых заказов" />
      ) : loadError && orders.length === 0 ? (
        <LoadFailed what="старые заказы" onRetry={() => fetchOrders()} />
      ) : orders.length === 0 ? (
        <EmptyState icon="inbox" title="Старых заказов нет" text="Новые заказы — в разделе «Оформление заказа»." />
      ) : filtered.length === 0 ? (
        <EmptyResult query={search.trim()} onReset={reset} resetLabel="Сбросить поиск и статус" />
      ) : (
        <ScrollHintBox className={erp.tableWrap} label="Старые заказы">
          <table className={erp.table}>
            <thead>
              <tr>
                {th('number', 'Номер')}
                {th('customer', 'Клиент')}
                <th scope="col">Изделие</th>
                {th('qty', 'Кол-во')}
                {th('sum', 'Сумма')}
                <th scope="col">Статус</th>
                {th('date', 'Дата')}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td className={styles.mono}>{o.order_number || '—'}</td>
                  <td>{o.data?.name || '—'}</td>
                  <td>{productOf(o)}</td>
                  <td className={styles.num}>{Number(o.total_qty) || 0}</td>
                  <td className={styles.num}>{rub(o.total_sum)}</td>
                  <td>{STATUS_LABELS[o.status] || STATUS_LABELS.draft}</td>
                  <td className={styles.date}>{dateOf(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </section>
  );
}
