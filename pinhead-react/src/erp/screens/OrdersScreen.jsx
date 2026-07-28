import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import { LoadFailed, EmptyResult } from '../components/ErpStates';
import { useErpStore } from '../store/useErpStore';
import { useErpSearch } from '../store/useErpSearch';
import { useErpAccess } from '../store/useErpAccess';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { isUrgent, isOverdue } from '../utils/time';
import { isOrderReadyToShip } from '../utils/stageUi';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import styles from '../erp.module.css';
import { DateField } from '../components/DateField';
import { Icon } from '../components/Icon';
import { OrderRow } from './orders/OrderRow';
import { OrderCardMobile } from './orders/OrderCardMobile';
import { CreateOrderModal } from './orders/CreateOrderModal';

export default function OrdersScreen() {
  const {
    orders, departments, loading, loaded, loadError, loadAll, deleteOrder, shipOrder,
    archiveLoaded, archiveLoading, archiveHasMore, loadArchive, loadMoreArchive,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      deleteOrder: s.deleteOrder,
      shipOrder: s.shipOrder,
      archiveLoaded: s.archiveLoaded,
      archiveLoading: s.archiveLoading,
      archiveHasMore: s.archiveHasMore,
      loadMoreArchive: s.loadMoreArchive,
      loadArchive: s.loadArchive,
    })),
  );
  // Фильтры сроков/готовности и открытие модалки создания — в URL (?filter=…, ?new=1),
  // чтобы работали ссылки с KPI-плиток и «Новый заказ» с дашборда
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(() => searchParams.get('new') === '1');
  // Поиск — из общего стора (то же поле, что в шапке): значения синхронны
  const query = useErpSearch((s) => s.query);
  const setQuery = useErpSearch((s) => s.setQuery);
  const isMobile = useMediaQuery('(max-width: 760px)');
  /**
   * Вкладка и даты — тоже в URL, рядом с `filter`. Раньше они жили в локальном
   * состоянии, и возврат «← Заказы» из архивного заказа приводил на вкладку
   * «Активные» со сброшенными датами; вместе с отсутствием useScrollRestore это
   * означало «начни поиск заново» на каждой позиции.
   */
  const patchParams = (patch) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    return next;
  }, { replace: true });
  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';
  const setDateFrom = (v) => patchParams({ from: v });
  const setDateTo = (v) => patchParams({ to: v });
  const tab = searchParams.get('tab') === 'archive' ? 'archive' : 'active';
  const setTab = (v) => patchParams({ tab: v === 'archive' ? 'archive' : '' });
  const filterParam = searchParams.get('filter');
  const filter = ['ready', 'urgent', 'overdue'].includes(filterParam) ? filterParam : null;
  const toggleFilter = (name) => patchParams({ filter: filter === name ? '' : name });
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
  // Возврат из карточки восстанавливает и позицию прокрутки (правило DESIGN.md)
  useScrollRestore(loaded);

  // Архив лениво: грузится при первом заходе на вкладку
  useEffect(() => {
    if (tab === 'archive' && !archiveLoaded && !archiveLoading) loadArchive();
  }, [tab, archiveLoaded, archiveLoading, loadArchive]);

  const access = useErpAccess();
  // Создание/удаление заказа — право матрицы «Создавать и править заказы».
  // Раньше удаление проверяло роль профиля прямо в компоненте (в обход useErpAccess),
  // а кнопка «Новый заказ» не проверяла ничего — её видел и рабочий цеха.
  const canManageOrders = access.can('order.manage');
  const canDelete = access.isPrivileged || canManageOrders;

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
        <div role="group" aria-label="Фильтр заказов" className={styles.filterRow}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={`${styles.chip} ${styles.chipBtn} ${tab === 'active' ? styles.chipProgress : styles.chipNeutral}`}
                        onClick={() => setTab('active')}
          >
            Активные ({orders.filter((o) => o.status === 'active').length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'archive'}
            className={`${styles.chip} ${styles.chipBtn} ${tab === 'archive' ? styles.chipProgress : styles.chipNeutral}`}
                        onClick={() => setTab('archive')}
          >
            Архив{archiveLoaded ? ` (${orders.filter((o) => o.status !== 'active').length})` : ''}
          </button>
          {tab === 'active' && (
            <>
              <button
                type="button"
                aria-pressed={filter === 'ready'}
                className={`${styles.chip} ${styles.chipBtn} ${filter === 'ready' ? styles.chipReady : styles.chipNeutral}`}
                                onClick={() => toggleFilter('ready')}
              >
                <Icon name="checkCircle" size={13} /> Готовы к отгрузке ({counts.ready})
              </button>
              <button
                type="button"
                aria-pressed={filter === 'urgent'}
                className={`${styles.chip} ${styles.chipBtn} ${filter === 'urgent' ? styles.chipProgress : styles.chipNeutral}`}
                                onClick={() => toggleFilter('urgent')}
              >
                <Icon name="clock" size={13} /> Срок ≤ 3 дней ({counts.urgent})
              </button>
              <button
                type="button"
                aria-pressed={filter === 'overdue'}
                className={`${styles.chip} ${styles.chipBtn} ${filter === 'overdue' ? styles.chipBlocked : styles.chipNeutral}`}
                                onClick={() => toggleFilter('overdue')}
              >
                <Icon name="clock" size={13} /> Просрочено ({counts.overdue})
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
          <DateField
            showFormatHint={false}
            value={dateFrom}
            max={dateTo || undefined}
            onChange={setDateFrom}
            aria-label="Дата создания: с"
          />
        </label>
        <label className={styles.checkLabel}>
          по
          <DateField
            showFormatHint={false}
            value={dateTo}
            min={dateFrom || undefined}
            onChange={setDateTo}
            aria-label="Дата создания: по"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => patchParams({ from: '', to: '' })}
          >
            Сбросить даты
          </button>
        )}
        <div className={styles.spacer} />
        <span className={styles.subText}>{filtered.length} из {inTab.length}</span>
        {canManageOrders && (
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Новый заказ
          </button>
        )}
      </div>

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="заказы" />}
      {!loadError && loading && !loaded && <TableSkeleton rows={6} label="Загрузка заказов" />}
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

      {/* Архив грузится страницами: явная кнопка вместо тихого лимита —
          видно, сколько уже загружено и есть ли ещё */}
      {tab === 'archive' && archiveLoaded && archiveHasMore && (
        <div className={styles.toolbar} style={{ justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={archiveLoading}
            onClick={loadMoreArchive}
          >
            {archiveLoading
              ? 'Загружаем…'
              : `Показать ещё (загружено ${inTab.length})`}
          </button>
        </div>
      )}

      {showCreate && (
        <CreateOrderModal
          onClose={() => {
            setShowCreate(false);
            if (searchParams.get('new')) {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('new');
                return next;
              }, { replace: true });
            }
          }}
        />
      )}
    </>
  );
}
