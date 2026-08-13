import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import { LoadFailed, EmptyResult } from '../components/ErpStates';
import { useErpStore } from '../store/useErpStore';
import { useErpSearch } from '../store/useErpSearch';
import { useErpAccess } from '../store/useErpAccess';
import { useCompactLayout } from '../layout/useCompactLayout';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { daysLeft, isUrgent } from '../utils/time';
import { isOrderReadyToShip, isOrderOverdue } from '../utils/stageUi';
import { ORDER_STATUS_LABELS } from '../types';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import styles from '../erp.module.css';
import { DateField } from '../components/DateField';
import { isRangeInverted } from '../utils/dateRange';
import { Icon } from '../components/Icon';
import { OrderRow } from './orders/OrderRow';
import { OrderCardMobile } from './orders/OrderCardMobile';
/**
 * Форма создания заказа — 1495 строк вместе с под-компонентами (позиции,
 * размерная сетка, ТЗ, превью маршрута), и всё это лежало в оболочке ERP,
 * которую скачивают все и всегда. Открывает её меньшинство и по требованию.
 *
 * Ленивый импорт именованного экспорта: `default` у модуля нет, поэтому
 * промис переупаковывается — иначе React.lazy не примет модуль.
 */
const CreateOrderModal = lazy(() => import('./orders/CreateOrderModal')
  .then((m) => ({ default: m.CreateOrderModal })));
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Pagination, DEFAULT_PAGE_SIZE } from '../components/Pagination';
import { SortableTh } from '../components/SortableTh';
import { sortRows } from '../utils/tableSort';
import { Button } from '../components/Button';
import { orderStatusLabel } from '../utils/format';

export default function OrdersScreen() {
  const {
    orders, departments, loading, loaded, loadError, loadAll, deleteOrder, shipOrder,
    archiveLoaded, archiveLoading, archiveHasMore, loadArchive, loadMoreArchive,
    showDemoOrders, setShowDemoOrders, setOrderDemo,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      showDemoOrders: s.showDemoOrders,
      setShowDemoOrders: s.setShowDemoOrders,
      setOrderDemo: s.setOrderDemo,
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
  const isCompact = useCompactLayout();
  /**
   * Вкладка и даты — тоже в URL, рядом с `filter`. Раньше они жили в локальном
   * состоянии, и возврат «← Заказы» из архивного заказа приводил на вкладку
   * «Активные» со сброшенными датами; вместе с отсутствием useScrollRestore это
   * означало «начни поиск заново» на каждой позиции.
   */
  /**
   * Любая правка подбора возвращает на первую страницу. Сброс живёт ЗДЕСЬ,
   * а не в эффекте: человек, стоявший на третьей странице, после ввода
   * в поиск видел пустоту и решал, что ничего не найдено. Эффект для этого
   * не годится — `setState` в теле эффекта ловит react-hooks, и он прав:
   * это следствие ДЕЙСТВИЯ, а не следствие рендера.
   */
  const patchParams = (patch) => {
    setPage(1);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v); else next.delete(k);
      }
      return next;
    }, { replace: true });
  };
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
      overdue: active.filter((o) => isOrderOverdue(o, daysLeft(o.due_date))).length,
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
  /**
   * Отгрузка закрывает заказ и уводит его в архив, поэтому она под правом,
   * а не под одной лишь готовностью. Кнопка показывалась всем, у кого заказ
   * выглядел готовым, — включая рабочего цеха, а страж заказа колонки
   * отгрузки не проверял вовсе. Право то же, что на сервере: склад делает
   * отгрузку с карточки упаковки, менеджер — из списка заказов.
   */
  const canShip = access.can('warehouse.manage') || canManageOrders;
  /**
   * Удаление — ТОЛЬКО администратор, ровно как политика `erp_orders_delete`
   * (`is_admin()`, то есть `profiles.role = 'admin'`).
   *
   * История правки. Сначала здесь стояло `isPrivileged || canManageOrders`:
   * менеджер видел «Удалить» и получал отказ. Правку сузили до `isPrivileged`
   * и подписали «ровно как на сервере» — но НЕ СВЕРИЛИ: `isPrivileged` это
   * `FULL_ACCESS_PROFILE_ROLES` = admin + director + РОП, а `is_admin()` —
   * только admin. Директор и РОП продолжали видеть кнопку.
   *
   * И отказ был хуже 42501: DELETE запрещается через `USING`, то есть
   * «удалено 0 строк», а не ошибка. Заказ пропадал из списка, всплывало
   * зелёное «Заказ удалён» — и заказ возвращался при следующей загрузке.
   * Проверено на живой базе: директор, удалено строк 0, заказ в базе остался.
   *
   * Сходимся на УЖЕ, а не на шире: удаление уносит позиции, этапы, материалы
   * и файлы. Понадобится директору — это строка в политике, а не догадка здесь.
   */
  const canDelete = access.isAdmin;

  const inTab = useMemo(
    () => orders.filter((o) => {
      if (tab === 'archive') return o.status !== 'active';
      if (o.status !== 'active') return false;
      if (filter === 'ready') return isOrderReadyToShip(o);
      if (filter === 'urgent') return isUrgent(o.due_date);
      if (filter === 'overdue') return isOrderOverdue(o, daysLeft(o.due_date));
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

  /**
   * Сортировка и страница — тот же паттерн, что на складе и в закупке.
   * До этого заказы были единственным длинным списком без обоих: 39 активных
   * рисовались одним куском и сортировались только тем порядком, в котором
   * приехали из запроса (по сроку клиента).
   *
   * Страница НЕ уходит в адрес намеренно: ссылку на заказ шлют по `/orders/:id`,
   * а «страница 3 списка» смысла не несёт и при смене фильтра сразу протухает.
   * Фильтры, вкладка, даты, поиск и сортировка — в адресе, они контекст.
   */
  const sortKey = searchParams.get('sort') || null;
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  // useMemo: объект-литерал пересоздавался каждый рендер и обнулял мемоизацию
  // сортировки — 39 заказов сортировались заново на любое движение состояния
  const sort = useMemo(() => ({ key: sortKey, dir: sortDir }), [sortKey, sortDir]);
  const sortBy = (key) => {
    const next = key !== sortKey ? { key, dir: 'asc' }
      : sortDir === 'asc' ? { key, dir: 'desc' }
        : { key: null, dir: 'asc' };
    patchParams({ sort: next.key || '', dir: next.key && next.dir === 'desc' ? 'desc' : '' });
  };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  /**
   * Значение колонки берётся ТО ЖЕ, что видно в ячейке (правило utils/tableSort):
   * иначе сортировка «по статусу» упорядочивала бы по внутреннему коду,
   * а человек видел бы подпись и не понимал порядка.
   */
  const sortValue = (o, key) => {
    switch (key) {
      case 'bitrix': return o.bitrix_id || null;
      case 'title': return o.title;
      case 'manager': return o.manager || null;
      case 'qty': return o.items.reduce((n, it) => n + (it.qty || 0), 0);
      case 'created': return o.created_at || null;
      case 'due': return o.due_date || null;
      // Готовность — то же вычисление, что рисует чип: сортировка «по статусу»
      // должна собирать вместе строки с одинаковой подписью
      case 'status': return isOrderReadyToShip(o) ? 'Готов к отгрузке' : orderStatusLabel(o, ORDER_STATUS_LABELS);
      default: return null;
    }
  };

  // Сортировка ДО пагинации: иначе сортируется только текущая страница
  const sorted = useMemo(() => sortRows(filtered, sort, sortValue), [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

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

  /**
   * Пометка «тестовый». Через подтверждение: при выключенном показе заказ
   * тут же исчезает из списка, и без предупреждения это читается как удаление.
   */
  const onToggleDemo = async (order) => {
    if (order.is_demo) {
      const done = await setOrderDemo(order.id, false);
      if (done) toast.success('Заказ снова в рабочем списке');
      return;
    }
    const ok = await confirm({
      title: 'Пометить заказ тестовым?',
      message: `«${order.title}» пропадёт из списков, счётчиков цехов и уведомлений. `
        + 'Заказ НЕ удаляется — его видно при включённом показе тестовых.',
      confirmLabel: 'Пометить',
    });
    if (ok) {
      const done = await setOrderDemo(order.id, true);
      if (done) toast.success('Заказ помечен тестовым и скрыт из рабочих списков');
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
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          aria-label="Поиск заказов"
        />
        <label className={styles.checkLabel}>
          Создан с
          <DateField
           
            value={dateFrom}
            max={dateTo || undefined}
            onChange={setDateFrom}
            aria-label="Дата создания: с"
          />
        </label>
        <label className={styles.checkLabel}>
          по
          <DateField
           
            value={dateTo}
            min={dateFrom || undefined}
            onChange={setDateTo}
            aria-label="Дата создания: по"
          />
        </label>
        {/* H-13: «с» позже «по» — интервал пуст, и список всегда будет пустым.
            Молчать об этом значит показывать «ничего не найдено» вместо причины */}
        {isRangeInverted(dateFrom, dateTo) && (
          <span className={styles.fieldError} role="status">
            «с» позже «по» — в таком интервале заказов не будет
          </span>
        )}
        {(dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => patchParams({ from: '', to: '' })}>
            Сбросить даты
          </Button>
        )}
        {/* Показ тестовых — руководящему составу: это отладочный режим, и цеху
            он показал бы работу, которой нет. Здесь `isPrivileged` уместен —
            это ФИЛЬТР СПИСКА, он ничего не пишет. Сама пометка «тестовый»
            (`onToggleDemo`) идёт под `isAdmin`: её страж требует `is_admin()`. */}
        {access.isPrivileged && (
          <label className={styles.checkLabel} title="Тестовые заказы скрыты из всех списков и счётчиков">
            <input
              type="checkbox"
              checked={showDemoOrders}
              onChange={(e) => setShowDemoOrders(e.target.checked)}
            />
            Показывать тестовые
          </label>
        )}
        <div className={styles.spacer} />
        <span className={styles.subText}>{filtered.length} из {inTab.length}</span>
        {canManageOrders && (
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + Новый заказ
          </Button>
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

      {pageRows.length > 0 && isCompact && (
        <div className={styles.orderCardList}>
          {pageRows.map((o) => (
            <OrderCardMobile
              key={o.id}
              order={o}
              departments={departments}
              onDelete={onDelete}
              canDelete={canDelete}
              onShip={canShip ? onShip : null}
              onToggleDemo={access.isAdmin ? onToggleDemo : undefined}
            />
          ))}
        </div>
      )}

      {pageRows.length > 0 && !isCompact && (
        <ScrollHintBox className={styles.tableWrap} label="Список заказов">
          <table className={styles.table}>
            <thead>
              <tr>
                <SortableTh sortKey="bitrix" sort={sort} onSort={sortBy}>№ сделки</SortableTh>
                <SortableTh sortKey="title" sort={sort} onSort={sortBy}>Заказ</SortableTh>
                <SortableTh sortKey="manager" sort={sort} onSort={sortBy}>Менеджер</SortableTh>
                <SortableTh sortKey="qty" sort={sort} onSort={sortBy}>Кол-во</SortableTh>
                <SortableTh sortKey="created" sort={sort} onSort={sortBy}>Создан</SortableTh>
                <SortableTh sortKey="due" sort={sort} onSort={sortBy}>Срок клиента</SortableTh>
                <SortableTh sortKey="status" sort={sort} onSort={sortBy}>Статус</SortableTh>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  departments={departments}
                  onDelete={onDelete}
                  canDelete={canDelete}
                  onShip={canShip ? onShip : null}
                  onToggleDemo={access.isAdmin ? onToggleDemo : undefined}
                />
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}

      {pageRows.length > 0 && (
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={sorted.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
        />
      )}

      {/* Архив грузится страницами: явная кнопка вместо тихого лимита —
          видно, сколько уже загружено и есть ли ещё */}
      {tab === 'archive' && archiveLoaded && archiveHasMore && (
        <div className={styles.toolbar} style={{ justifyContent: 'center', marginTop: 12 }}>
          <Button variant="secondary" disabled={archiveLoading} onClick={loadMoreArchive}>
            {archiveLoading
              ? 'Загружаем…'
              : `Показать ещё (загружено ${inTab.length})`}
          </Button>
        </div>
      )}

      {/* Без fallback: модалка появляется по клику, и скелетон поверх экрана
          мигал бы сильнее, чем задержка загрузки чанка на цеховом Wi-Fi. */}
      {showCreate && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </>
  );
}
