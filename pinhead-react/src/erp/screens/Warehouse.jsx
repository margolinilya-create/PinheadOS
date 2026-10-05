import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { FgIntakeQueue } from './warehouse/FgIntakeQueue';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useCompactLayout } from '../layout/useCompactLayout';
import { FilterBar } from '../components/FilterBar';
import { Pagination } from '../components/Pagination';
import { useErpStore } from '../store/useErpStore';
import { sortRows, useTableSort } from '../utils/tableSort';
import { purchasingReturnHref } from '../utils/receiptLink';
import { FilterChip } from '../components/FilterChip';
import styles from '../styles';
import { WarehouseTaskTable } from './warehouse/WarehouseTaskTable';
import { WarehouseTaskDrawer } from './warehouse/WarehouseTaskDrawer';
import {
  DUE_FILTERS, TABS, TYPE_ORDER, isTaskInTab, isTaskOpen, matchesDue, matchesTaskQuery,
  tabOf, warehouseSortValue,
} from './warehouse/warehouseTasks';
import { useErpAccess } from '../store/useErpAccess';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { useListParams } from '../hooks/useListParams';
import { factoryToday } from '../../utils/date';

/**
 * Склад — РАБОЧИЙ ЭКРАН ПО ОПЕРАЦИЯМ (правка заказчика 05.10, п. 8).
 *
 * «В общем списке смешаны материалы, подряд, готовые изделия и отгрузки.
 * Везде одинаковое „Открыть". Приёмку приходится искать по страницам».
 * Теперь вкладки — операции склада (приёмка материалов, готовые изделия,
 * подряд, отгрузка; «Все» отдельно), кнопка называет операцию задачи
 * и открывает её форму, поиск идёт по ВСЕМ записям (с названием материала
 * задачи), а по умолчанию видны открытые задачи с фильтром по срокам.
 *
 * ВЕСЬ КОНТЕКСТ — В АДРЕСЕ (`useListParams`): вкладка, поиск, «только
 * открытые», срок, страница и открытая задача. После сохранения формы
 * человек остаётся там же, где был, а закрытая задача уходит из открытых.
 * Задачу по ссылке (`?task=`) открывает и переход из закупки (п. 7) —
 * тогда в панели есть «← К закупке», и закрытие возвращает туда же.
 *
 * Правила (вкладки, подписи, срок, поиск) — `warehouse/warehouseTasks`,
 * таблица и карточки — `WarehouseTaskTable`, форма — `WarehouseTaskDrawer`.
 * Бизнес-логика (acceptMaterial/advanceWarehouseTask, гейты, отгрузка)
 * не менялась.
 */

/** Умолчания адреса — константой модуля: от неё зависят колбэки хука */
const LIST_DEFAULTS = { tab: 'all', open: '1' };

export default function Warehouse() {
  const {
    orders, loaded, loadError, loadAll, subcontractingLoaded, loadSubcontracting,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders, loaded: s.loaded, loadError: s.loadError, loadAll: s.loadAll,
      subcontractingLoaded: s.subcontractingLoaded,
      loadSubcontracting: s.loadSubcontracting,
    })),
  );
  /**
   * Движение складских задач — под `warehouse.manage` (решение заказчика 10.08).
   * Гейт стоит и на сервере (RLS `erp_warehouse_tasks`), и здесь: одно без
   * другого даёт либо дыру, либо «кнопка есть, действие падает».
   */
  const canManageWarehouse = useErpAccess().can('warehouse.manage');
  const navigate = useNavigate();
  const list = useListParams(LIST_DEFAULTS);
  const tab = tabOf(list.get('tab')).key;
  const query = list.get('q');
  const onlyOpen = list.get('open') !== '0';
  const due = DUE_FILTERS.some((d) => d.key === list.get('due')) ? list.get('due') : '';
  const openId = list.get('task') || null;
  const [pageSize, setPageSize] = useState(10);
  const { sort, toggle: toggleSort } = useTableSort();
  /**
   * Ниже 1024px (и на любом тач-устройстве) — карточки вместо таблицы:
   * шесть колонок на планшете уезжали за край вместе с колонкой «Действие».
   */
  const isCompact = useCompactLayout();
  const today = factoryToday();

  // Смена сортировки возвращает на первую страницу
  const sortBy = (key) => { toggleSort(key); list.setPage(1); };

  /**
   * Сброс подбора для «ничего не найдено». Снимает и «Только открытые»:
   * чаще всего задача не пропала, а закрылась, и именно эта галочка её прячет.
   */
  const resetFilters = () => list.patch({ q: '', tab: '', due: '', open: '0' });

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  /** Позиция прокрутки при возврате из карточки заказа (правка 03.09) */
  useScrollRestore(loaded);
  /**
   * Карточки подрядчика нужны приёмке подряда: сколько передано, сколько
   * вернулось, кто подрядчик. Реестр ленивый — без этой загрузки склад
   * увидел бы приёмку без единого числа.
   */
  useEffect(() => {
    if (!subcontractingLoaded) loadSubcontracting();
  }, [subcontractingLoaded, loadSubcontracting]);

  const allRows = useMemo(() => {
    const rows = [];
    for (const o of orders) {
      if (o.status !== 'active') continue;
      for (const t of (o.warehouse_tasks ?? [])) rows.push({ order: o, task: t });
    }
    return rows.sort((a, b) => {
      const byType = (TYPE_ORDER[a.task.task_type] ?? 9) - (TYPE_ORDER[b.task.task_type] ?? 9);
      return byType || (a.task.created_at || '').localeCompare(b.task.created_at || '');
    });
  }, [orders]);

  /**
   * Подбор БЕЗ вкладки: по нему считаются счётчики вкладок — они показывают
   * то же, что человек увидит, нажав на вкладку (обход 04.09: плитка
   * «Упаковка 14» над таблицей из трёх строк).
   */
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(({ order, task }) => {
      if (onlyOpen && !isTaskOpen(task)) return false;
      if (!matchesDue(order, task, due, today)) return false;
      return matchesTaskQuery(order, task, q);
    });
  }, [allRows, onlyOpen, due, query, today]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [
    t.key, matched.filter(({ task }) => isTaskInTab(task, t.key)).length,
  ])), [matched]);

  const filtered = useMemo(
    () => matched.filter(({ task }) => isTaskInTab(task, tab)), [matched, tab]);

  // Сортировка до пагинации: иначе переупорядочилась бы только текущая страница
  const sorted = useMemo(() => sortRows(filtered, sort, warehouseSortValue), [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(list.page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Открытая задача — свежая из стора (после действий обновляется)
  let open = null;
  if (openId) {
    for (const o of orders) {
      const t = (o.warehouse_tasks ?? []).find((x) => x.id === openId);
      if (t) { open = { order: o, task: t }; break; }
    }
  }

  /** Пришли из закупки — возврат туда же, с её фильтрами (правка 05.10, п. 7) */
  const fromPurchasing = list.get('from') === 'purchasing';
  const returnHref = fromPurchasing ? purchasingReturnHref(list.get('back'), list.get('supply')) : null;
  const closeTask = () => {
    if (returnHref) navigate(returnHref);
    else list.patchKeep({ task: '' });
  };
  const openTask = (id) => list.patchKeep({ task: id, from: '', back: '', supply: '' });

  return (
    <>
      <PageHead title="Склад" sub="Приёмка материалов, готовые изделия, подряд и отгрузка." />

      <FilterBar
        search={query} onSearch={(v) => list.patch({ q: v })}
        searchPlaceholder="Поиск: заказ, № сделки, материал, поставщик" searchLabel="Поиск задач склада"
        right={(
          <label className={styles.checkRow}>
            <input
              type="checkbox" checked={onlyOpen}
              onChange={(e) => list.patch({ open: e.target.checked ? '1' : '0' })}
            />
            <span className={styles.subText}>Только открытые</span>
          </label>
        )}
      >
        {TABS.map((f) => (
          <FilterChip key={f.key} active={tab === f.key} onClick={() => list.patch({ tab: f.key })}>
            {f.label} {counts[f.key] > 0 && <b>{counts[f.key]}</b>}
          </FilterChip>
        ))}
      </FilterBar>
      <div className={styles.toolbar} role="group" aria-label="Срок">
        <span className={styles.subText}>Срок:</span>
        {DUE_FILTERS.map((d) => (
          <FilterChip key={d.key} active={due === d.key} onClick={() => list.patch({ due: due === d.key ? '' : d.key })}>
            {d.label}
          </FilterChip>
        ))}
      </div>

      {/*
        ПРИЁМКА ГОТОВОГО ИЗДЕЛИЯ (правки 07.09, п. 9) — ЭТАПЫ маршрута, а не
        складские задачи, поэтому свой блок над списком. С 05.10 (п. 8) он
        живёт во вкладке готовых изделий и в «Все»: во вкладке материалов
        приёмок готовых изделий быть не должно.
      */}
      {(tab === 'all' || tab === 'goods') && <FgIntakeQueue />}

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="задачи склада" />}
      {/* Скелетон — на `!loaded && !loadError`, а не на `loading` (правило UX-2) */}
      {!loaded && !loadError && <TableSkeleton rows={6} label="Загрузка задач склада" />}

      {/* «Работы нет» и «под фильтры ничего не попало» — разные ответы */}
      {loaded && filtered.length === 0 && allRows.length === 0 && (
        <EmptyState
          icon="box"
          title="Задач склада нет"
          text="Они появляются сами: приёмку материалов заводит закупка, остальные — цеха по мере закрытия этапов."
        />
      )}
      {loaded && filtered.length === 0 && allRows.length > 0 && (
        <EmptyResult query={query.trim()} onReset={resetFilters}>
          {query.trim()
            ? undefined
            : onlyOpen
              ? 'Открытых задач под выбранный фильтр нет — возможно, они уже закрыты.'
              : 'Под выбранный фильтр ничего не попало.'}
        </EmptyResult>
      )}

      {loaded && filtered.length > 0 && (
        <WarehouseTaskTable
          rows={pageRows}
          materials={tab === 'materials'}
          compact={isCompact}
          sort={sort}
          onSort={sortBy}
          onOpen={openTask}
        />
      )}

      {/* Пагинация одна на обе раскладки: страница — свойство подбора */}
      {loaded && filtered.length > 0 && (
        <Pagination
          page={safePage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
          onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }}
        />
      )}

      {open && (
        <WarehouseTaskDrawer
          open={open}
          onClose={closeTask}
          canManage={canManageWarehouse}
          returnHref={returnHref}
        />
      )}
    </>
  );
}
