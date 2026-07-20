import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useErpStore } from '../store/useErpStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { isUrgent, isOverdue } from '../utils/time';
import { isOrderReadyToShip } from '../utils/stageUi';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import styles from '../erp.module.css';
import { OrderRow } from './orders/OrderRow';
import { OrderCardMobile } from './orders/OrderCardMobile';
import { CreateOrderModal } from './orders/CreateOrderModal';

export default function OrdersScreen({ user }) {
  const {
    orders, departments, loading, loaded, loadAll, deleteOrder, shipOrder,
    archiveLoaded, archiveLoading, loadArchive,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      deleteOrder: s.deleteOrder,
      shipOrder: s.shipOrder,
      archiveLoaded: s.archiveLoaded,
      archiveLoading: s.archiveLoading,
      loadArchive: s.loadArchive,
    })),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tab, setTab] = useState('active'); // active | archive
  const isMobile = useMediaQuery('(max-width: 760px)');
  // Фильтры сроков/готовности — в URL (?filter=ready|urgent|overdue),
  // чтобы работали ссылки с KPI-плиток дашборда
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const filter = ['ready', 'urgent', 'overdue'].includes(filterParam) ? filterParam : null;
  const toggleFilter = (name) =>
    setSearchParams(filter === name ? {} : { filter: name }, { replace: true });
  // Счётчики чипов — та же логика, что у KPI-плиток дашборда (активные заказы)
  const counts = useMemo(() => {
    const active = orders.filter((o) => o.status === 'active');
    return {
      ready: active.filter((o) => isOrderReadyToShip(o)).length,
      urgent: active.filter((o) => isUrgent(o.due_date)).length,
      overdue: active.filter((o) => isOverdue(o.due_date)).length,
    };
  }, [orders]);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  // Архив лениво: грузится при первом заходе на вкладку
  useEffect(() => {
    if (tab === 'archive' && !archiveLoaded && !archiveLoading) loadArchive();
  }, [tab, archiveLoaded, archiveLoading, loadArchive]);

  const canDelete = ['admin', 'director'].includes(user?.role);

  const inTab = useMemo(
    () => orders.filter((o) => {
      if (tab === 'archive') return o.status !== 'active';
      if (o.status !== 'active') return false;
      if (filter === 'ready') return isOrderReadyToShip(o);
      if (filter === 'urgent') return isUrgent(o.due_date);
      if (filter === 'overdue') return isOverdue(o.due_date);
      return true;
    }),
    [orders, tab, filter],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inTab.filter((o) => {
      if (q) {
        const match =
          o.title.toLowerCase().includes(q) ||
          (o.bitrix_id || '').includes(q) ||
          (o.manager || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      // Фильтр по дате создания (границы включительно, каждая необязательна)
      const created = (o.created_at || '').slice(0, 10);
      if (dateFrom && (!created || created < dateFrom)) return false;
      if (dateTo && (!created || created > dateTo)) return false;
      return true;
    });
  }, [inTab, query, dateFrom, dateTo]);

  const onDelete = async (order) => {
    const ok = await confirm({
      title: 'Удалить заказ?',
      message: `«${order.title}» и все его позиции, этапы и материалы будут удалены.`,
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (ok) {
      const done = await deleteOrder(order.id);
      if (done) toast.success('Заказ удалён');
    }
  };

  const onShip = async (order) => {
    const ok = await confirm({
      title: `Отгрузить заказ «${order.title}»?`,
      message: 'Заказ уйдёт в архив.',
      confirmLabel: 'Отгрузить',
    });
    if (ok) await shipOrder(order.id);
  };

  return (
    <>
      <PageHead title="Заказы" sub="Производственные заказы: позиции, маршрут по цехам, сроки." />

      <div className={styles.toolbar}>
        <div role="tablist" aria-label="Фильтр заказов" className={styles.filterRow}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={`${styles.chip} ${tab === 'active' ? styles.chipProgress : styles.chipNeutral}`}
            style={{ cursor: 'pointer', font: 'inherit' }}
            onClick={() => setTab('active')}
          >
            Активные ({orders.filter((o) => o.status === 'active').length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'archive'}
            className={`${styles.chip} ${tab === 'archive' ? styles.chipProgress : styles.chipNeutral}`}
            style={{ cursor: 'pointer', font: 'inherit' }}
            onClick={() => setTab('archive')}
          >
            Архив{archiveLoaded ? ` (${orders.filter((o) => o.status !== 'active').length})` : ''}
          </button>
          {tab === 'active' && (
            <>
              <button
                type="button"
                aria-pressed={filter === 'ready'}
                className={`${styles.chip} ${filter === 'ready' ? styles.chipReady : styles.chipNeutral}`}
                style={{ cursor: 'pointer', font: 'inherit' }}
                onClick={() => toggleFilter('ready')}
              >
                ✅ Готовы к отгрузке ({counts.ready})
              </button>
              <button
                type="button"
                aria-pressed={filter === 'urgent'}
                className={`${styles.chip} ${filter === 'urgent' ? styles.chipProgress : styles.chipNeutral}`}
                style={{ cursor: 'pointer', font: 'inherit' }}
                onClick={() => toggleFilter('urgent')}
              >
                🔥 Срок ≤ 3 дней ({counts.urgent})
              </button>
              <button
                type="button"
                aria-pressed={filter === 'overdue'}
                className={`${styles.chip} ${filter === 'overdue' ? styles.chipBlocked : styles.chipNeutral}`}
                style={{ cursor: 'pointer', font: 'inherit' }}
                onClick={() => toggleFilter('overdue')}
              >
                ⏰ Просрочено ({counts.overdue})
              </button>
            </>
          )}
        </div>
        <input
          type="search"
          className={`${styles.input} ${styles.searchInput}`}
          placeholder="Поиск: название, № сделки, менеджер"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск заказов"
        />
        <label className={styles.checkLabel}>
          Создан с
          <input
            type="date"
            className={styles.input}
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Дата создания: с"
          />
        </label>
        <label className={styles.checkLabel}>
          по
          <input
            type="date"
            className={styles.input}
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Дата создания: по"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setDateFrom(''); setDateTo(''); }}
          >
            Сбросить даты
          </button>
        )}
        <div className={styles.spacer} />
        <span className={styles.subText}>{filtered.length} из {inTab.length}</span>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Новый заказ
        </button>
      </div>

      {loading && !loaded && <TableSkeleton rows={6} label="Загрузка заказов" />}
      {loaded && tab === 'archive' && !archiveLoaded && (
        <TableSkeleton rows={4} label="Загрузка архива" />
      )}

      {loaded && (tab !== 'archive' || archiveLoaded) && filtered.length === 0 && (
        <div className={styles.emptyState}>
          {inTab.length === 0
            ? tab === 'active'
              ? filter === 'ready'
                ? 'Готовых к отгрузке заказов пока нет.'
                : filter === 'urgent'
                  ? 'Заказов со сроком ≤ 3 дней нет.'
                  : filter === 'overdue'
                    ? 'Просроченных заказов нет.'
                    : 'Активных заказов нет — создайте первый.'
              : 'Архив пуст.'
            : 'Ничего не найдено по запросу.'}
        </div>
      )}

      {filtered.length > 0 && isMobile && (
        <div className={styles.orderCardList}>
          {filtered.map((o) => (
            <OrderCardMobile
              key={o.id}
              order={o}
              departments={departments}
              onDelete={onDelete}
              canDelete={canDelete}
              onShip={onShip}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && !isMobile && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№ сделки</th>
                <th>Заказ</th>
                <th>Менеджер</th>
                <th>Кол-во</th>
                <th>Создан</th>
                <th>Срок клиента</th>
                <th>Статус</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  departments={departments}
                  onDelete={onDelete}
                  canDelete={canDelete}
                  onShip={onShip}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateOrderModal onClose={() => setShowCreate(false)} />}
    </>
  );
}
