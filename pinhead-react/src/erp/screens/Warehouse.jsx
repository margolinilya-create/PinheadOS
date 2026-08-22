import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useCompactLayout } from '../layout/useCompactLayout';
import { Badge } from '../components/Badge';
import { FilterBar } from '../components/FilterBar';
import { Pagination } from '../components/Pagination';
import { Drawer } from '../components/Drawer';
import { SortableTh } from '../components/SortableTh';
import { Icon } from '../components/Icon';
import { useErpStore } from '../store/useErpStore';
import { matchesOrderQuery } from '../utils/orderSearch';
import { sortRows, useTableSort } from '../utils/tableSort';
import { formatDateShort } from '../utils/time';
import {
  WAREHOUSE_TASK_TYPE_LABELS, MARKING_STATUS_LABELS, PACK_SHIP_STATUS_LABELS,
  FG_RECEIPT_STATUS_LABELS,
  SUBCONTRACT_RECEIPT_STATUS_LABELS,
} from '../types';
import styles from '../erp.module.css';
import { MaterialReceiptCard } from './warehouse/MaterialReceiptCard';
import { FgReceiptCard } from './warehouse/FgReceiptCard';
import { MarkingCard } from './warehouse/MarkingCard';
import { PackShipCard } from './warehouse/PackShipCard';
import { SubcontractReceiptCard } from './warehouse/SubcontractReceiptCard';
import { WarehouseTaskCard } from './warehouse/WarehouseTaskCard';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Button } from '../components/Button';
import { ReadOnlyFieldset } from '../components/ReadOnlyFieldset';
import { useErpAccess } from '../store/useErpAccess';

/**
 * Склад (редизайн): таблица задач (KPI + вкладки по типу + пагинация); детали и действия
 * задачи открываются в правом Drawer (переиспользуются карточки приёмки/маркировки/упаковки).
 * Бизнес-логика (acceptMaterial/advanceWarehouseTask, гейты, отгрузка) не менялась.
 */

const TYPE_ICON = {
  material_receipt: 'inbox', subcontract_receipt: 'truck', marking: 'tag',
  fg_receipt: 'checkCircle', pack_ship: 'box',
};
/**
 * Терминальный статус каждого типа задачи. ПРОПУЩЕННЫЙ здесь тип даёт вечный
 * бейдж на пункте меню: задача закрыта, `taskVariant` не считает её готовой,
 * счётчик «только открытые» продолжает её считать — и никто не понимает,
 * что именно горит. Соответствие сторожит `warehouseTaskTypes.test.ts`.
 */
const TERMINAL = {
  material_receipt: 'accepted', subcontract_receipt: 'accepted', marking: 'issued',
  fg_receipt: 'accepted', pack_ship: 'shipped',
};
// Порядок в списке повторяет ход заказа: материалы → подряд → маркировка →
// приёмка готовой продукции → упаковка
const TYPE_ORDER = {
  material_receipt: 0, subcontract_receipt: 1, marking: 2, fg_receipt: 3, pack_ship: 4,
};
const RECEIPT_LABELS = { awaiting: 'Ожидает приёмки', accepted: 'Принято', awaiting_receipt: 'Ожидает приёмки' };

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'material_receipt', label: 'Приёмка материалов' },
  { key: 'subcontract_receipt', label: 'Приёмка подряда' },
  { key: 'marking', label: 'Маркировка' },
  { key: 'fg_receipt', label: 'Приёмка ГП' },
  { key: 'pack_ship', label: 'Упаковка/отгрузка' },
];

function taskStatusLabel(task) {
  switch (task.task_type) {
    case 'marking': return MARKING_STATUS_LABELS[task.status] ?? task.status;
    case 'pack_ship': return PACK_SHIP_STATUS_LABELS[task.status] ?? task.status;
    case 'subcontract_receipt': return SUBCONTRACT_RECEIPT_STATUS_LABELS[task.status] ?? task.status;
    case 'fg_receipt': return FG_RECEIPT_STATUS_LABELS[task.status] ?? task.status;
    default: return RECEIPT_LABELS[task.status] ?? task.status;
  }
}
function taskVariant(task) {
  if (task.status === TERMINAL[task.task_type]) return 'ready';
  if (task.status === 'awaiting' || task.status === 'awaiting_receipt' || task.status === 'new') return 'waiting';
  return 'progress';
}
/** Краткое «содержимое» задачи для колонки таблицы */
function taskSummary(order, task) {
  if (task.task_type === 'subcontract_receipt') {
    /**
     * Подрядных приёмок у заказа может быть НЕСКОЛЬКО (сублимация и варка
     * у одной позиции — прямой пример документа), и подпись «Готовое изделие»
     * не различала их вовсе. Называем операцию и изделие: склад по этой
     * строке решает, что именно принимает.
     */
    for (const it of order.items ?? []) {
      const st = (it.stages ?? []).find((s) => s.id === task.stage_id);
      if (st) {
        const op = st.operation?.trim() || 'Подряд';
        return `${op} · ${it.product_type}${it.variant ? ` (${it.variant})` : ''}`;
      }
    }
    return 'Готовое изделие';
  }
  if (task.task_type === 'material_receipt') {
    const n = order.materials.length;
    return `${n} ${n === 1 ? 'материал' : 'материалов'}`;
  }
  if (task.task_type === 'marking') return task.marking_type || 'Маркировка';
  if (task.task_type === 'fg_receipt') {
    const qty = order.items.reduce((sum, it) => sum + (it.qty || 0), 0);
    return `${qty} шт с производства`;
  }
  return 'Упаковка и отгрузка';
}

/**
 * Значение колонки для сортировки — то же, что видно в ячейке.
 * Срок сортируется по ISO-строке даты: она уже лексикографически монотонна.
 */
function warehouseSortValue({ order, task }, key) {
  switch (key) {
    case 'type': return WAREHOUSE_TASK_TYPE_LABELS[task.task_type];
    case 'order': return order.bitrix_id || order.title;
    case 'summary': return taskSummary(order, task);
    case 'status': return taskStatusLabel(task);
    case 'deadline': return task.deadline;
    default: return null;
  }
}

export default function Warehouse() {
  const {
    orders, loaded, loadError, loadAll, acceptMaterial, advanceWarehouseTask,
    submitWarehouseReport, subcontractingLoaded, loadSubcontracting,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders, loaded: s.loaded, loadError: s.loadError, loadAll: s.loadAll,
      acceptMaterial: s.acceptMaterial, advanceWarehouseTask: s.advanceWarehouseTask,
      submitWarehouseReport: s.submitWarehouseReport,
      subcontractingLoaded: s.subcontractingLoaded,
      loadSubcontracting: s.loadSubcontracting,
    })),
  );
  /**
   * Движение складских задач — под `warehouse.manage` (решение заказчика 10.08).
   * Прежде задачи склада принимали запись от любого участника ERP: швея могла
   * отметить продукцию принятой — а это открывает упаковку — и отгрузить её.
   * Гейт стоит и на сервере (RLS `erp_warehouse_tasks`), и здесь: одно без
   * другого даёт либо дыру, либо «кнопка есть, действие падает».
   */
  const canManageWarehouse = useErpAccess().can('warehouse.manage');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openId, setOpenId] = useState(null);
  const { sort, toggle: toggleSort } = useTableSort();
  /**
   * Ниже 1024px (и на любом тач-устройстве) — карточки вместо таблицы.
   * Тот же приём и тот же порог, что у очереди цеха и списка заказов:
   * шесть колонок на планшете уезжали за край вместе с колонкой «Действие».
   */
  const isCompact = useCompactLayout();

  // Смена сортировки возвращает на первую страницу
  const sortBy = (key) => { toggleSort(key); setPage(1); };

  /**
   * Сброс подбора для «ничего не найдено». Снимает и «Только открытые»:
   * чаще всего задача не пропала, а закрылась, и именно эта галочка её прячет.
   */
  const resetFilters = () => {
    setQuery(''); setTab('all'); setOnlyOpen(false); setPage(1);
  };

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  /**
   * Карточки подрядчика нужны приёмке подряда: сколько передано, сколько
   * вернулось, кто подрядчик. Реестр ленивый — без этой загрузки склад
   * увидел бы приёмку без единого числа.
   */
  useEffect(() => {
    if (!subcontractingLoaded) loadSubcontracting();
  }, [subcontractingLoaded, loadSubcontracting]);

  const allRows = useMemo(() => {
    const list = [];
    for (const o of orders) {
      if (o.status !== 'active') continue;
      for (const t of (o.warehouse_tasks ?? [])) list.push({ order: o, task: t });
    }
    return list.sort((a, b) => {
      const byType = (TYPE_ORDER[a.task.task_type] ?? 9) - (TYPE_ORDER[b.task.task_type] ?? 9);
      return byType || (a.task.created_at || '').localeCompare(b.task.created_at || '');
    });
  }, [orders]);

  /**
   * Счётчики считаются по тому же набору, что виден в списке. Раньше они брались
   * из allRows (со всеми закрытыми задачами), а список по умолчанию фильтрует
   * onlyOpen — над таблицей из трёх строк висела плитка «Упаковка/отгрузка 14».
   */
  const counts = useMemo(() => {
    /**
     * Начальные нули берутся ИЗ `TERMINAL`, а не перечисляются руками.
     * Перечисленные руками, они пропустили `fg_receipt`: `undefined + 1` даёт
     * `NaN`, проверка `counts[key] > 0` всегда ложна — и вкладка «Приёмка ГП»
     * не показывала число открытых задач НИКОГДА. Ошибка тихая: экран
     * выглядит рабочим, просто одна цифра всегда пуста.
     */
    const c = { all: 0 };
    for (const type of Object.keys(TERMINAL)) c[type] = 0;
    for (const { task } of allRows) {
      if (onlyOpen && task.status === TERMINAL[task.task_type]) continue;
      c.all += 1;
      c[task.task_type] += 1;
    }
    return c;
  }, [allRows, onlyOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(({ order, task }) => {
      if (tab !== 'all' && task.task_type !== tab) return false;
      if (onlyOpen && task.status === TERMINAL[task.task_type]) return false;
      if (q && !matchesOrderQuery(order, q)) return false;
      return true;
    });
  }, [allRows, tab, onlyOpen, query]);

  // Сортировка до пагинации: иначе переупорядочилась бы только текущая страница
  const sorted = useMemo(() => sortRows(filtered, sort, warehouseSortValue), [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Открытая в Drawer задача — берём свежую из стора (после действий обновляется).
  // Дешёвый поиск, без useMemo (ранние return в memo не сохраняются React-компилятором).
  let open = null;
  if (openId) {
    for (const o of orders) {
      const t = (o.warehouse_tasks ?? []).find((x) => x.id === openId);
      if (t) { open = { order: o, task: t }; break; }
    }
  }

  return (
    <>
      <PageHead title="Склад" sub="Приёмка материалов, приёмка подряда, маркировка, упаковка и отгрузка." />

      {loaded && (
        <div className={styles.dashKpis} style={{ marginBottom: 16 }}>
          {[
            { key: 'all', icon: 'orders', cls: '', label: 'Все задачи', val: counts.all },
            { key: 'material_receipt', icon: 'inbox', cls: styles.kpiIconWarn, label: 'Приёмка материалов', val: counts.material_receipt },
            { key: 'subcontract_receipt', icon: 'truck', cls: styles.kpiIconViolet, label: 'Приёмка подряда', val: counts.subcontract_receipt },
            { key: 'marking', icon: 'tag', cls: '', label: 'Маркировка', val: counts.marking },
            // Плитки «Приёмка ГП» здесь не было вовсе, хотя вкладка есть:
            // тип задачи заведён во всех остальных местах, а на этом экране
            // его не видно ни счётчиком, ни плиткой
            { key: 'fg_receipt', icon: 'inbox', cls: styles.kpiIconViolet, label: 'Приёмка ГП', val: counts.fg_receipt },
            { key: 'pack_ship', icon: 'box', cls: styles.kpiIconOk, label: 'Упаковка/отгрузка', val: counts.pack_ship },
          ].map((k) => (
            // Плитка кликабельна целиком и фильтрует список — как в закупке
            // (правило DESIGN.md). Раньше это были неинтерактивные <div>.
            <button
              key={k.label}
              type="button"
              className={styles.kpiCard}
              aria-pressed={tab === k.key}
              onClick={() => { setTab(tab === k.key ? 'all' : k.key); setPage(1); }}
            >
              <span className={`${styles.kpiIcon} ${k.cls}`}><Icon name={k.icon} size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>{k.label}</span>
                <span className={styles.kpiCardValue}>{k.val}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <FilterBar
        search={query} onSearch={(v) => { setQuery(v); setPage(1); }}
        searchPlaceholder="Поиск: заказ, № сделки, изделие, материал" searchLabel="Поиск задач склада"
        right={(
          <label className={styles.checkRow}>
            <input type="checkbox" checked={onlyOpen} onChange={(e) => { setOnlyOpen(e.target.checked); setPage(1); }} />
            <span className={styles.subText}>Только открытые</span>
          </label>
        )}
      >
        {TABS.map((f) => (
          <button
            key={f.key} type="button" aria-pressed={tab === f.key}
            className={`${styles.chip} ${styles.chipBtn} ${tab === f.key ? styles.chipProgress : styles.chipNeutral}`}
                        onClick={() => { setTab(f.key); setPage(1); }}
          >
            {f.label} {counts[f.key] > 0 && <b>{counts[f.key]}</b>}
          </button>
        ))}
      </FilterBar>

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="задачи склада" />}
      {/* Скелетон висит на `!loaded && !loadError`, а не на `loading`: при сбое
          `loading` уже false, и экран замирал бы навсегда (правило UX-2).
          До этой правки при загрузке здесь не было НИЧЕГО — пустая страница,
          неотличимая от «задач нет». */}
      {!loaded && !loadError && <TableSkeleton rows={6} label="Загрузка задач склада" />}

      {/* «Работы нет» и «под фильтры ничего не попало» — разные ответы, и
          человеку нужен разный следующий шаг. Прежде оба показывались одной
          серой строкой, различавшей только галочку «Только открытые». */}
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

      {loaded && filtered.length > 0 && isCompact && (
        <div className={styles.dataCardList}>
          {pageRows.map(({ order, task }) => (
            <WarehouseTaskCard
              key={task.id}
              typeLabel={WAREHOUSE_TASK_TYPE_LABELS[task.task_type]}
              typeIcon={TYPE_ICON[task.task_type]}
              orderNo={order.bitrix_id}
              orderTitle={order.title}
              summary={taskSummary(order, task)}
              statusLabel={taskStatusLabel(task)}
              statusVariant={taskVariant(task)}
              deadline={formatDateShort(task.deadline)}
              onOpen={() => setOpenId(task.id)}
            />
          ))}
        </div>
      )}

      {loaded && filtered.length > 0 && !isCompact && (
        <ScrollHintBox className={styles.tableWrap} label="Задачи склада">
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableTh sortKey="type" sort={sort} onSort={sortBy}>Тип задачи</SortableTh>
                  <SortableTh sortKey="order" sort={sort} onSort={sortBy}>Заказ</SortableTh>
                  <SortableTh sortKey="summary" sort={sort} onSort={sortBy}>Содержимое</SortableTh>
                  <SortableTh sortKey="status" sort={sort} onSort={sortBy}>Статус</SortableTh>
                  <SortableTh sortKey="deadline" sort={sort} onSort={sortBy}>Срок</SortableTh>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ order, task }) => (
                  <tr key={task.id} className={styles.rowClickable} onClick={() => setOpenId(task.id)}>
                    <td>
                      <span className={styles.cellWithIcon}>
                        <Icon name={TYPE_ICON[task.task_type]} size={15} />
                        {WAREHOUSE_TASK_TYPE_LABELS[task.task_type]}
                      </span>
                    </td>
                    <td>№{order.bitrix_id || '—'}<div className={styles.cellSub} title={order.title}>{order.title}</div></td>
                    <td>{taskSummary(order, task)}</td>
                    <td><Badge variant={taskVariant(task)}>{taskStatusLabel(task)}</Badge></td>
                    <td>{formatDateShort(task.deadline) || '—'}</td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={(e) => { e.stopPropagation(); setOpenId(task.id); }}>
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollHintBox>
      )}

      {/* Пагинация одна на обе раскладки: страница и её размер — свойство
          подбора, а не таблицы */}
      {loaded && filtered.length > 0 && (
        <Pagination
          page={safePage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
        />
      )}

      {open && (
        <Drawer
          onClose={() => setOpenId(null)}
          title={`${WAREHOUSE_TASK_TYPE_LABELS[open.task.task_type]}`}
          subtitle={`№${open.order.bitrix_id || '—'} · ${open.order.title}`}
          badge={<Badge variant={taskVariant(open.task)}>{taskStatusLabel(open.task)}</Badge>}
        >
          <ReadOnlyFieldset
            canManage={canManageWarehouse}
            note="Только просмотр: движение складских задач ведёт кладовщик."
          >
            {open.task.task_type === 'material_receipt' && (
              <MaterialReceiptCard
                order={open.order}
                task={open.task}
                onAccept={acceptMaterial}
              />
            )}
            {open.task.task_type === 'subcontract_receipt' && (
              <SubcontractReceiptCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
            )}
            {open.task.task_type === 'fg_receipt' && (
              <FgReceiptCard
                order={open.order}
                task={open.task}
                onSubmit={submitWarehouseReport}
              />
            )}
            {open.task.task_type === 'marking' && (
              <MarkingCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
            )}
            {open.task.task_type === 'pack_ship' && (
              <PackShipCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
            )}
          </ReadOnlyFieldset>
        </Drawer>
      )}
    </>
  );
}
