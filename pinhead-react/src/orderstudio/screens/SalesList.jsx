import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSalesStore } from '../store/useSalesStore';
import { useAuthStore } from '../../store/useAuthStore';
import { EmptyResult, EmptyState } from '../../erp/components/ErpStates';
/*
 * Скелетон — тот же примитив, что у списков ERP. Импорт держит ErpStates
 * и ErpSkeletons в ОДНОМ общем чанке: с одним ErpStates сборка выносила его
 * в отдельный CSS, и оболочка ERP переходила бюджет CSS на ~400 Б.
 */
import { TableSkeleton } from '../../erp/components/ErpSkeletons';
import { parseDateLocal } from '../../utils/date';
import { isSalesLead, ordersLabel } from '../layout/orderNav';
import { STATUS_LABELS, rub } from './labels';
import { filterSalesList, isFiltered } from './salesListFilter';
import { useNewOrder } from './useNewOrder';
import styles from './Sales.module.css';

const fmtDate = (d) => {
  if (!d) return '—';
  const date = parseDateLocal(d);
  return date ? date.toLocaleDateString('ru-RU') : '—';
};

/** «Обновлён»: дата и время правки — список сортируется по нему */
const fmtUpdated = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS);

/**
 * Список заказов v4. Видимость строк решает RLS (продавец — свои,
 * руководство — все); экран добавляет поиск, статус и «Мои / Все»
 * у руководства. Фильтры живут в адресе: ссылка на отфильтрованный список
 * открывает его же.
 */
export default function SalesList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const { list, listLoading, loadList } = useSalesStore(useShallow((s) => ({
    list: s.list,
    listLoading: s.listLoading,
    loadList: s.loadList,
  })));
  const { start: onCreate, busy: creating } = useNewOrder();

  useEffect(() => { loadList(); }, [loadList]);

  const lead = isSalesLead(user);
  const filter = {
    query: params.get('q') ?? '',
    status: params.get('status') ?? '',
    mine: lead && params.get('mine') === '1',
  };
  const uid = user?.id ?? null;
  // Строк не больше 200 (`fetchSalesOrders`) — фильтр на каждом рендере дёшев
  const rows = filterSalesList(list, filter, uid);

  const setParam = (key, value) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  };
  const resetFilters = () => setParams({}, { replace: true });

  const title = ordersLabel(user);
  const createLabel = creating ? 'Открываем…' : 'Новый заказ';

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.sub}>Расчёт, КП и ТЗ заказа</div>
        </div>
        <button type="button" className={`btn btn-primary ${styles.touch}`} onClick={onCreate} disabled={creating}>
          {createLabel}
        </button>
      </div>

      {listLoading && list.length === 0 ? (
        <TableSkeleton label="Загрузка заказов" />
      ) : list.length === 0 ? (
        <EmptyState
          icon="orders"
          title="Заказов пока нет"
          text="Начните с нового заказа: изделие, клиент и доставка, ТЗ и цена — на одном экране."
          action={(
            <button type="button" className={`btn btn-primary ${styles.touch}`} onClick={onCreate} disabled={creating}>
              {createLabel}
            </button>
          )}
        />
      ) : (
        <>
          <div className={styles.filters}>
            <input
              type="search"
              className={styles.search}
              placeholder="Клиент или номер"
              aria-label="Поиск по клиенту и номеру"
              value={filter.query}
              onChange={(e) => setParam('q', e.target.value)}
            />
            <label className={styles.filterLabel}>
              <span>Статус</span>
              <select
                className={styles.select}
                value={filter.status}
                onChange={(e) => setParam('status', e.target.value)}
              >
                <option value="">Любой</option>
                {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {lead && (
              <div className={styles.segmented} role="group" aria-label="Чьи заказы">
                <button type="button" aria-pressed={filter.mine} onClick={() => setParam('mine', '1')}>Мои</button>
                <button type="button" aria-pressed={!filter.mine} onClick={() => setParam('mine', '')}>Все</button>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <EmptyResult query={filter.query} onReset={isFiltered(filter) ? resetFilters : undefined} resetLabel="Сбросить фильтры" />
          ) : (
            <table className={`${styles.table} ${styles.listTable}`}>
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Клиент</th>
                  <th>Название</th>
                  {lead && <th>Менеджер</th>}
                  <th>Статус</th>
                  <th className={styles.right}>Сумма</th>
                  <th>Срок</th>
                  <th>Обновлён</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td className={styles.num} data-label="Номер">
                      <button type="button" className={styles.link} onClick={() => navigate(`/sales/${o.id}`)}>
                        {o.order_number || 'без номера'}
                      </button>
                    </td>
                    <td data-label="Клиент">{o.customer || '—'}</td>
                    <td data-label="Название">{o.title || <span className={styles.muted}>без названия</span>}</td>
                    {lead && <td data-label="Менеджер">{o.manager_name || '—'}</td>}
                    <td data-label="Статус"><span className={styles.badge}>{STATUS_LABELS[o.status] ?? o.status}</span></td>
                    <td className={`${styles.num} ${styles.right}`} data-label="Сумма">{rub(o.price_total)}</td>
                    <td className={styles.num} data-label="Срок">{fmtDate(o.due_date)}</td>
                    <td className={styles.num} data-label="Обновлён">{fmtUpdated(o.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
