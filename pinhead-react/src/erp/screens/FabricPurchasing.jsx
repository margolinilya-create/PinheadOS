import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { PreliminarySection } from './purchasing/PreliminarySection';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useCompactLayout } from '../layout/useCompactLayout';
import { PurchaseRowCard } from './purchasing/PurchaseRowCard';
import { PurchaseMaterialsTable } from './purchasing/PurchaseMaterialsTable';
import { ProcurementTasksTable } from './purchasing/ProcurementTasksTable';
import { DictionaryDatalist } from '../components/DictionaryDatalist';
import { Drawer } from '../components/Drawer';
import { FilterBar } from '../components/FilterBar';
import { Pagination } from '../components/Pagination';
import { sortRows, useTableSort } from '../utils/tableSort';
import { useErpStore } from '../store/useErpStore';
import { SupplierOptionsModal } from './purchasing/SupplierOptionsModal';
import { useStagePermissions } from '../store/useStagePermissions';
import { SupplyQueue } from './purchasing/SupplyQueue';
import { PurchaseCard } from './purchasing/PurchaseCard';
import { AddPurchaseModal } from './purchasing/AddPurchaseModal';
import { findSupplyDept, ordersAwaitingSupply } from '../utils/supply';
import { MATERIAL_STATUS_LABELS } from '../types';
import { FilterChip } from '../components/FilterChip';
import styles from '../styles';
import { Button } from '../components/Button';
import { factoryToday } from '../../utils/date';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { useListParams } from '../hooks/useListParams';

/**
 * Закупка: очередь заказов, ждущих закупки, и карточка закупки выбранного
 * заказа — в ШИРОКОЙ ПАНЕЛИ поверх списка (правка 05.10, п. 6).
 *
 * «Карточка закупки открывается под общим списком заказов, до неё
 * приходится скроллить… Открывать закупку отдельной карточкой или в широкой
 * области. Материалы и действия видны сразу. При возврате сохранять поиск,
 * фильтры и место в списке». До правки карточка рисовалась блоком под
 * списком: на длинной очереди до неё прокручивали, а после неё — обратно.
 * Теперь список остаётся на месте (и с ним прокрутка), а карточка выезжает
 * панелью; закрыли — человек там же, где был.
 *
 * Весь контекст — в адресе (`useListParams`): заказ (`supply`), поиск (`q`),
 * фильтр статуса (`status`) и страница (`page`). Его же уносит с собой
 * переход к приёмке на складе (п. 7) и возвращает ссылка «← К закупке».
 * Бизнес-логика (addMaterial/updateMaterial/confirmStockMaterial/procurement)
 * не менялась.
 */

/**
 * Значение колонки для сортировки. Берём ровно то, что видно в ячейке
 * (статус — подписью, а не кодом), иначе порядок нельзя объяснить глазами.
 */
function purchaseSortValue({ order, m }, key) {
  switch (key) {
    case 'order': return order.bitrix_id || order.title;
    case 'material': return m.name;
    case 'supplier': return m.supplier;
    case 'article': return m.article;
    case 'plan': return m.qty_expected;
    case 'received': return m.qty_received ?? m.received_at;
    case 'status': return MATERIAL_STATUS_LABELS[m.status];
    default: return null;
  }
}

/**
 * Группа статуса для фильтр-вкладок.
 * Статус приоритетнее даты: как только материал заказан/в пути/пришёл, он выходит из «Просрочено»
 * (иначе строка с прошедшим eta зависала в «Просрочено» после смены статуса — ERP-01/ERP-02).
 * «Просрочено» = только ещё не заказанная закупка с истёкшим eta.
 */
function statusGroup(m, today) {
  if (m.status === 'received' || m.status === 'reserved') return 'arrived';
  if (m.status === 'ordered' || m.status === 'in_transit' || m.status === 'partial') return 'transit';
  if (m.source === 'purchase' && m.eta_date && m.eta_date < today && m.status !== 'not_needed') return 'overdue';
  return 'awaiting';
}

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'awaiting', label: 'Ожидается' },
  { key: 'transit', label: 'В пути' },
  { key: 'arrived', label: 'Пришло' },
  { key: 'overdue', label: 'Просрочено' },
];

/** Умолчания адреса — константой модуля: от неё зависят колбэки хука */
const LIST_DEFAULTS = { status: 'all' };

export default function FabricPurchasing() {
  const {
    orders, departments, loaded, loadError, loadAll, addMaterial, updateMaterial,
    confirmStockMaterial, updateProcurementTask, takeSupply, closeSupply,
    addSupplierOption, updateSupplierOption, selectSupplierOption, deleteSupplierOption,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders, departments: s.departments,
      loaded: s.loaded, loadError: s.loadError,
      loadAll: s.loadAll, addMaterial: s.addMaterial, updateMaterial: s.updateMaterial,
      confirmStockMaterial: s.confirmStockMaterial, updateProcurementTask: s.updateProcurementTask,
      takeSupply: s.takeSupply, closeSupply: s.closeSupply,
      addSupplierOption: s.addSupplierOption,
      updateSupplierOption: s.updateSupplierOption,
      selectSupplierOption: s.selectSupplierOption,
      deleteSupplierOption: s.deleteSupplierOption,
    })),
  );
  const list = useListParams(LIST_DEFAULTS);
  const query = list.get('q');
  const tab = TABS.some((t) => t.key === list.get('status')) ? list.get('status') : 'all';
  const [pageSize, setPageSize] = useState(10);
  /** Модалка «Новая закупка»: false | { orderId } — заказ предвыбран из карточки */
  const [adding, setAdding] = useState(false);
  /** Открытая модалка сравнения вариантов поставщика: { material, order } */
  const [optionsFor, setOptionsFor] = useState(null);
  const { sort, toggle: toggleSort } = useTableSort();
  /**
   * Ниже 1024px (и на любом тач-устройстве) — карточки вместо таблицы:
   * «Закупка» входит в пилот наравне со «Складом», с планшета с ней и работают.
   */
  const isCompact = useCompactLayout();
  const today = factoryToday();

  // Смена сортировки возвращает на первую страницу: иначе человек нажимает
  // «по сроку» и остаётся на пятой странице уже другого списка
  const sortBy = (key) => { toggleSort(key); list.setPage(1); };

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  /**
   * Позиция прокрутки при возврате из карточки заказа (правка 03.09).
   * С 05.10 карточка закупки — панель поверх списка, и её открытие
   * прокрутку не трогает вовсе.
   */
  useScrollRestore(loaded);

  const activeOrders = useMemo(() => orders.filter((o) => o.status === 'active'), [orders]);

  /**
   * Заказы, у которых этап «Закупка» ещё открыт, — собственно работа участка.
   * Считается от ЭТАПА, а не от материалов: заказ без заведённых материалов
   * тоже ждёт закупки, и именно он раньше не показывался нигде.
   */
  const supplyDept = useMemo(() => findSupplyDept(departments), [departments]);
  const supplyOrders = useMemo(
    () => ordersAwaitingSupply(orders, departments), [orders, departments]);
  /**
   * Права спрашиваются ПО ДЕЙСТВИЮ и по цеху закупки — так же, как в очереди
   * цеха. Без прав карточка остаётся на чтение: видеть свою закупку важно
   * и тому, кто в ней не работает (менеджер заказа).
   */
  const supplyPerms = useStagePermissions(supplyDept?.id ?? null);

  /**
   * ЗАВЕРШЁННЫЕ ЗАКУПКИ (п. 1.5–1.6): заказы с заведёнными материалами,
   * у которых открытых этапов закупки уже нет. Свёрнутый архив внизу
   * страницы — данные не удаляются, просто уходят из рабочей очереди.
   */
  const doneOrders = useMemo(() => {
    const openIds = new Set(supplyOrders.map((o) => o.id));
    return activeOrders.filter((o) => !openIds.has(o.id) && (o.materials?.length ?? 0) > 0);
  }, [activeOrders, supplyOrders]);
  const selectableOrders = useMemo(
    () => [...supplyOrders, ...doneOrders], [supplyOrders, doneOrders]);

  /**
   * ВЫБРАННЫЙ ЗАКАЗ ЖИВЁТ В АДРЕСЕ (`?supply=`), правка 23.08, п. 1: ссылку
   * на конкретную закупку можно переслать, а возврат из карточки заказа или
   * со склада открывает её снова. Пропавший из очереди и архива заказ выбор
   * снимает сам.
   */
  const requestedId = list.get('supply');
  const selectedOrder = useMemo(
    () => selectableOrders.find((o) => o.id === requestedId) ?? null,
    [selectableOrders, requestedId],
  );

  /**
   * ЕДИНСТВЕННЫЙ ЗАКАЗ В ОЧЕРЕДИ ОТКРЫВАЕТСЯ САМ (обход 04.09) — и только
   * при первой загрузке экрана. С 05.10 карточка — панель, которую можно
   * закрыть: эффект без этой отметки открывал бы её снова сразу после
   * закрытия, и до списка было бы не добраться.
   */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!loaded || autoOpened.current) return;
    autoOpened.current = true;
    if (!requestedId && supplyOrders.length === 1) list.patchKeep({ supply: supplyOrders[0].id });
  }, [loaded, requestedId, supplyOrders, list]);

  /** Открыть закупку заказа: подбор карточки начинается заново */
  const selectOrder = (id) => list.patch({ supply: id, q: '', status: '' });
  const closeCard = () => list.patch({ supply: '', q: '', status: '' });

  /** Строки материалов выбранного заказа {order, m, group} */
  const allRows = useMemo(() => (selectedOrder
    ? selectedOrder.materials.map((m) => ({ order: selectedOrder, m, group: statusGroup(m, today) }))
    : []), [selectedOrder, today]);

  /** Счётчики чипов считают ТО ЖЕ, что показывает таблица под ними (обход 04.09) */
  const counts = useMemo(() => {
    const c = { all: allRows.length, awaiting: 0, transit: 0, arrived: 0, overdue: 0 };
    for (const r of allRows) c[r.group] += 1;
    return c;
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => {
      if (tab !== 'all' && r.group !== tab) return false;
      if (!q) return true;
      return r.m.name.toLowerCase().includes(q)
        || (r.m.color || '').toLowerCase().includes(q)
        || (r.m.article || '').toLowerCase().includes(q)
        || (r.m.supplier || '').toLowerCase().includes(q);
    });
  }, [allRows, tab, query]);

  // Сортировка идёт ДО пагинации: иначе отсортировалась бы только текущая страница
  const sorted = useMemo(() => sortRows(filtered, sort, purchaseSortValue), [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(list.page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  /**
   * Смена статуса закупщиком (правка 12.09, п. 8). Ветки `received` здесь
   * НЕТ: приход пишет только `erp_material_accept` одной транзакцией
   * с журналом, а селект такой пункт и не предлагает (`StatusControl`).
   * Отметка закупщика о прибытии остаток не увеличивает (правка 05.10, п. 7).
   */
  const setStatus = useCallback(async (m, status) => {
    await updateMaterial(m.id, { status });
  }, [updateMaterial]);

  /** Сброс подбора для «ничего не найдено» — и поиск, и вкладка сразу */
  const resetFilters = () => list.patch({ q: '', status: '' });

  /**
   * Обработчики строк — стабильные: карточки планшета в `memo`, и функция,
   * заново созданная на каждый рендер экрана, перерисовывала их все разом.
   */
  const handlers = useMemo(() => ({
    onUpdate: updateMaterial,
    onOpenOptions: setOptionsFor,
    onConfirmStock: confirmStockMaterial,
    onSetStatus: setStatus,
  }), [updateMaterial, confirmStockMaterial, setStatus]);

  return (
    <>
      <PageHead title="Закупка" sub="Работа с материалами и поставщиками." />
      <DictionaryDatalist kind="supplier" id="erp-suppliers-table" />

      {/* Ошибка и скелетон — на верхнем уровне экрана (правка 03.09): внутри
          карточки, требующей `loaded`, они недостижимы по построению */}
      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="закупку" />}
      {!loadError && !loaded && <TableSkeleton rows={8} label="Загрузка закупки" />}

      {/* Очередь участка идёт ПЕРВОЙ: это ответ на вопрос «что делать сейчас» */}
      {loaded && (
        <SupplyQueue
          orders={supplyOrders}
          supplyDept={supplyDept}
          today={today}
          selectedId={selectedOrder?.id ?? null}
          onSelect={selectOrder}
        />
      )}

      {/* Предварительная закупка (п. 17): исключение при сжатых сроках, свёрнута */}
      {loaded && <PreliminarySection orders={orders} />}

      <ProcurementTasksTable orders={activeOrders} onUpdate={updateProcurementTask} />

      {/* Завершённые закупки — внизу страницы и свёрнуты (правка 24.08, п. 2) */}
      {loaded && doneOrders.length > 0 && (
        <details className={styles.matSection}>
          <summary>Завершённые закупки ({doneOrders.length})</summary>
          <SupplyQueue
            orders={doneOrders}
            supplyDept={supplyDept}
            today={today}
            selectedId={selectedOrder?.id ?? null}
            onSelect={selectOrder}
            title={null}
            label="Завершённые закупки"
            emptyText="Завершённых закупок нет."
          />
        </details>
      )}

      {loaded && selectedOrder && (
        <Drawer
          wide
          onClose={closeCard}
          title="Карточка закупки"
          subtitle={`№${selectedOrder.bitrix_id || '—'} · ${selectedOrder.title}`}
        >
          <PurchaseCard
            order={selectedOrder}
            supplyDept={supplyDept}
            perms={supplyPerms}
            today={today}
            onTake={takeSupply}
            onClose={closeSupply}
            onAddMaterial={(orderId) => setAdding({ orderId })}
          >
            {tab !== 'all' && (
              <div className={`${styles.toolbar} ${styles.toolbarUnderHead}`}>
                <span className={`${styles.chip} ${styles.chipProgress}`}>
                  Фильтр: {TABS.find((t) => t.key === tab)?.label}
                </span>
                <Button variant="ghost" onClick={() => list.patch({ status: '' })}>
                  Сбросить фильтр
                </Button>
              </div>
            )}

            <FilterBar
              search={query} onSearch={(v) => list.patch({ q: v })}
              searchPlaceholder="Поиск: материал, цвет, артикул, поставщик"
              searchLabel="Поиск по закупке"
            >
              {TABS.map((f) => (
                <FilterChip key={f.key} active={tab === f.key} onClick={() => list.patch({ status: f.key })}>
                  {f.label} {counts[f.key] > 0 && <b>{counts[f.key]}</b>}
                </FilterChip>
              ))}
            </FilterBar>

            {/* «Закупать нечего» и «подбор всё отсеял» — разные ответы */}
            {filtered.length === 0 && allRows.length === 0 && (
              <EmptyState
                icon="inbox"
                title="Закупочных строк нет"
                text="Лист закупки задаёт менеджер при создании заказа. Отдельную позицию можно завести кнопкой «+ Материал»."
              />
            )}
            {filtered.length === 0 && allRows.length > 0 && (
              <EmptyResult query={query.trim()} onReset={resetFilters} resetLabel="Сбросить всё" />
            )}

            {filtered.length > 0 && isCompact && (
              <div className={styles.dataCardList}>
                {pageRows.map(({ order, m }) => (
                  <PurchaseRowCard key={m.id} order={order} m={m} {...handlers} />
                ))}
              </div>
            )}
            {filtered.length > 0 && !isCompact && (
              <PurchaseMaterialsTable rows={pageRows} sort={sort} onSort={sortBy} {...handlers} />
            )}

            {filtered.length > 0 && (
              <Pagination
                page={safePage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
                onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }}
              />
            )}
          </PurchaseCard>
        </Drawer>
      )}

      {adding && (
        <AddPurchaseModal
          orders={activeOrders}
          orderId={adding.orderId ?? ''}
          onAdd={addMaterial}
          onClose={() => setAdding(false)}
        />
      )}

      {optionsFor && (() => {
        // Материал берём из свежего стора: после выбора/правки варианта строка меняется,
        // а в optionsFor лежит снимок на момент открытия
        const fresh = orders
          .flatMap((o) => o.materials.map((m) => ({ m, o })))
          .find(({ m }) => m.id === optionsFor.material.id);
        if (!fresh) return null;
        return (
          <SupplierOptionsModal
            material={fresh.m}
            order={fresh.o}
            actions={{ addSupplierOption, updateSupplierOption, selectSupplierOption, deleteSupplierOption }}
            onClose={() => setOptionsFor(null)}
          />
        );
      })()}
    </>
  );
}
