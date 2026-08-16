import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed } from '../components/ErpStates';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { TableSkeleton } from '../components/ErpSkeletons';
import { Badge } from '../components/Badge';
import { DictionaryDatalist } from '../components/DictionaryDatalist';
import { FilterBar } from '../components/FilterBar';
import { Pagination } from '../components/Pagination';
import { SortableTh } from '../components/SortableTh';
import { DateField } from '../components/DateField';
import { Icon } from '../components/Icon';
import { sortRows, useTableSort } from '../utils/tableSort';
import { useErpStore } from '../store/useErpStore';
import { OrderLink } from '../components/OrderLink';
import { orderLinkTarget } from '../utils/orderLink';
import { toast } from '../../store/useToastStore';
import { pluralize } from '../../utils/i18n';
import { SupplierOptionsModal } from './purchasing/SupplierOptionsModal';
import { SupplyQueue } from './purchasing/SupplyQueue';
import { findSupplyDept, ordersAwaitingSupply } from '../utils/supply';
import { formatDateShort, procurementSla } from '../utils/time';
import {
  MATERIAL_STATUS_LABELS,
  PROCUREMENT_CAUSE_LABELS,
  PROCUREMENT_KIND_LABELS,
  PROCUREMENT_STATUS_LABELS,
} from '../types';
import styles from '../erp.module.css';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Button } from '../components/Button';
import { factoryToday } from '../../utils/date';

/**
 * Закупка (редизайн): плоская таблица закупочных строк по всем активным заказам
 * (KPI-плитки + фильтр по статусу + пагинация), инлайн-правки план/цвет/артикул/статус,
 * «Новая закупка» — модалка добавления материала. Дозакупки/замены — секцией ниже.
 * Бизнес-логика (addMaterial/updateMaterial/confirmStockMaterial/procurement) не менялась.
 */

const KIND_LABELS = { fabric: 'Ткань', hardware: 'Фурнитура', labels: 'Бирки/этикетки', packaging: 'Упаковка', other: 'Прочее' };
const SOURCE_LABELS = { purchase: 'Закупка', stock: 'Со склада', client: 'Давальческое', none: 'Без закупки' };

const STATUS_VARIANT = {
  pending: 'waiting', ordered: 'progress', in_transit: 'progress',
  partial: 'waiting', received: 'ready', reserved: 'ready', not_needed: 'neutral',
};

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

function procurementSortValue({ order, t }, key) {
  switch (key) {
    case 'order': return order.bitrix_id || order.title;
    case 'material': return t.material_name;
    case 'kind': return PROCUREMENT_KIND_LABELS[t.kind];
    case 'cause': return PROCUREMENT_CAUSE_LABELS[t.cause_type];
    case 'supplier': return t.supplier;
    case 'status': return PROCUREMENT_STATUS_LABELS[t.status];
    default: return null;
  }
}

/**
 * Группа статуса для KPI-плиток и фильтр-вкладок.
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

const EMPTY_MAT = {
  order_id: '', kind: 'fabric', name: '', source: 'purchase', supplier: '',
  color: '', article: '', qty: '', qty_expected: '', unit: '', price_per_unit: '', eta_date: '',
};

/**
 * Модалка «Новая закупка».
 *
 * `orderId` предвыбирает заказ: из очереди закупки материал заводят конкретному
 * заказу, и заставлять искать его в списке из полусотни — лишний шаг ровно там,
 * где человек уже сказал, о каком заказе речь.
 */
function AddPurchaseModal({ orders, orderId = '', onAdd, onClose }) {
  // Без трапа Tab уходил под оверлей, а Escape не закрывал — при объявленном aria-modal
  const trapRef = useFocusTrap(true, onClose);
  const [form, setForm] = useState({ ...EMPTY_MAT, order_id: orderId });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.order_id) { toast.error('Выберите заказ'); return; }
    if (!form.name.trim()) { toast.error('Укажите материал'); return; }
    /**
     * План прихода БОЛЬШЕ НЕ ОБЯЗАТЕЛЕН (правка заказчика 16.08, п. 13):
     * «менеджер зачастую не знает эту информацию на момент запуска, поле должен
     * заполнять закупщик после взаимодействия с поставщиком». Строку заводят
     * ДО разговора с поставщиком — и раньше её нельзя было завести вовсе,
     * не выдумав дату.
     *
     * Плановое количество обязательным остаётся: без него закупка не закроется
     * автоматически (`supply.missingPlan`), то есть строка просто застрянет.
     */
    if (form.source === 'purchase' && (!form.qty_expected || Number(form.qty_expected) <= 0)) {
      toast.error('Укажите плановое количество'); return;
    }
    setSaving(true);
    const row = await onAdd(form.order_id, {
      kind: form.kind, name: form.name.trim(), source: form.source,
      supplier: form.supplier.trim() || null, color: form.color.trim() || null,
      article: form.article.trim() || null, qty: form.qty.trim() || null,
      qty_expected: form.qty_expected === '' ? null : Number(form.qty_expected),
      unit: form.unit.trim() || null,
      price_per_unit: form.price_per_unit === '' ? null : Number(form.price_per_unit),
      eta_date: form.eta_date || null,
      status: form.source === 'purchase' || form.source === 'stock' ? 'pending' : 'received',
    });
    setSaving(false);
    if (row) onClose();
  };

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
      <div ref={trapRef} className={styles.modal} role="dialog" aria-modal="true" aria-label="Новая закупка" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>Новая закупка</div>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Заказ</span>
            <select className={styles.select} value={form.order_id} onChange={(e) => set({ order_id: e.target.value })} aria-label="Заказ">
              <option value="">Выберите заказ…</option>
              {orders.map((o) => <option key={o.id} value={o.id}>№{o.bitrix_id || '—'} · {o.title}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип</span>
            <select className={styles.select} value={form.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Тип материала">
              {Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Материал</span>
            <input className={styles.input} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Кулирка 230гр чёрная" aria-label="Материал" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Цвет</span>
            <input className={styles.input} value={form.color} onChange={(e) => set({ color: e.target.value })} aria-label="Цвет" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Артикул</span>
            <input className={styles.input} value={form.article} onChange={(e) => set({ article: e.target.value })} aria-label="Артикул" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Источник</span>
            <select className={styles.select} value={form.source} onChange={(e) => set({ source: e.target.value })} aria-label="Источник">
              {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Поставщик</span>
            {/* Подсказки из справочника поставщиков (правка 12), ввод свободный */}
            <DictionaryDatalist kind="supplier" id="erp-suppliers-modal" />
            <input
              className={styles.input}
              value={form.supplier}
              onChange={(e) => set({ supplier: e.target.value })}
              list="erp-suppliers-modal"
              aria-label="Поставщик"
            />
          </label>
          {/* Единица — метка, а не коэффициент: «кг» стояло в подписи жёстко,
              и ткань в метрах, бирки в штуках и упаковка в пачках подписывались
              килограммами. Пересчёта между единицами система не делает */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>План, кол-во</span>
            <input type="number" min="0" step="0.01" className={styles.input} value={form.qty_expected} onChange={(e) => set({ qty_expected: e.target.value })} aria-label="Плановое количество" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Единица</span>
            <input
              className={styles.input}
              value={form.unit}
              onChange={(e) => set({ unit: e.target.value })}
              list="erp-units"
              placeholder="кг, м, шт"
              aria-label="Единица измерения"
            />
            <DictionaryDatalist id="erp-units" kind="unit" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Цена за единицу</span>
            <input
              type="number" min="0" step="0.01" className={styles.input}
              value={form.price_per_unit}
              onChange={(e) => set({ price_per_unit: e.target.value })}
              aria-label="Цена за единицу"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>План прихода</span>
            <DateField value={form.eta_date} onChange={(v) => set({ eta_date: v })} aria-label="План прихода" />
          </label>
        </div>
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={saving} onClick={submit}>Добавить</Button>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'awaiting', label: 'Ожидается' },
  { key: 'transit', label: 'В пути' },
  { key: 'arrived', label: 'Пришло' },
  { key: 'overdue', label: 'Просрочено' },
];

/**
 * Верхние показатели (правка 14) — не только статистика, но и быстрый переход:
 * клик по всей плитке фильтрует список по её статусу, а если позиция одна —
 * сразу открывает карточку её заказа.
 */
const KPIS = [
  { key: 'all', icon: 'orders', cls: '', label: 'Всего строк', hint: 'Показать все закупки без фильтра' },
  { key: 'awaiting', icon: 'clock', cls: 'kpiIconWarn', label: 'Ожидается', hint: 'Позиции, ожидающие заказа или обработки' },
  { key: 'transit', icon: 'truck', cls: '', label: 'В пути', hint: 'Отправленные, но ещё не поступившие позиции' },
  { key: 'arrived', icon: 'checkCircle', cls: 'kpiIconOk', label: 'Пришло', hint: 'Поступившие позиции' },
  { key: 'overdue', icon: 'alert', cls: 'kpiIconDanger', label: 'Просрочено', hint: 'Просроченные позиции' },
];

export default function FabricPurchasing() {
  const {
    orders, departments, loading, loaded, loadError, loadAll, addMaterial, updateMaterial,
    confirmStockMaterial, updateProcurementTask, takeSupply, closeSupply,
    addSupplierOption, updateSupplierOption, selectSupplierOption, deleteSupplierOption,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders, departments: s.departments,
      loading: s.loading, loaded: s.loaded, loadError: s.loadError,
      loadAll: s.loadAll, addMaterial: s.addMaterial, updateMaterial: s.updateMaterial,
      confirmStockMaterial: s.confirmStockMaterial, updateProcurementTask: s.updateProcurementTask,
      takeSupply: s.takeSupply, closeSupply: s.closeSupply,
      addSupplierOption: s.addSupplierOption,
      updateSupplierOption: s.updateSupplierOption,
      selectSupplierOption: s.selectSupplierOption,
      deleteSupplierOption: s.deleteSupplierOption,
    })),
  );
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /** Модалка «Новая закупка»: false | { orderId } — заказ предвыбран из очереди */
  const [adding, setAdding] = useState(false);
  /** Открытая модалка сравнения вариантов поставщика: { material, order } */
  const [optionsFor, setOptionsFor] = useState(null);
  const { sort, toggle: toggleSort } = useTableSort();
  const { sort: procSort, toggle: toggleProcSort } = useTableSort();
  const today = factoryToday();
  const navigate = useNavigate();
  const location = useLocation();

  // Смена сортировки возвращает на первую страницу: иначе человек нажимает
  // «по сроку» и остаётся на пятой странице уже другого списка
  const sortBy = (key) => { toggleSort(key); setPage(1); };

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const activeOrders = useMemo(() => orders.filter((o) => o.status === 'active'), [orders]);

  /**
   * Заказы, у которых этап «Закупка» ещё открыт, — собственно работа участка.
   * Считается от ЭТАПА, а не от материалов: заказ без заведённых материалов
   * тоже ждёт закупки, и именно он раньше не показывался нигде.
   */
  const supplyDept = useMemo(() => findSupplyDept(departments), [departments]);
  const supplyOrders = useMemo(
    () => ordersAwaitingSupply(orders, departments), [orders, departments]);

  /** Плоские закупочные строки {order, material, group} по активным заказам */
  const allRows = useMemo(() => {
    const rows = [];
    for (const o of activeOrders) {
      for (const m of o.materials) rows.push({ order: o, m, group: statusGroup(m, today) });
    }
    return rows;
  }, [activeOrders, today]);

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
      return r.order.title.toLowerCase().includes(q)
        || (r.order.bitrix_id || '').includes(q)
        || r.m.name.toLowerCase().includes(q)
        || (r.m.article || '').toLowerCase().includes(q)
        || (r.m.supplier || '').toLowerCase().includes(q);
    });
  }, [allRows, tab, query]);

  // Сортировка идёт ДО пагинации: иначе отсортировалась бы только текущая страница
  const sorted = useMemo(
    () => sortRows(filtered, sort, purchaseSortValue),
    [filtered, sort],
  );

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const procurementRows = useMemo(
    () => activeOrders.flatMap((o) => (o.procurement_tasks ?? []).map((t) => ({ order: o, t }))),
    [activeOrders],
  );
  const sortedProcurement = useMemo(
    () => sortRows(procurementRows, procSort, procurementSortValue),
    [procurementRows, procSort],
  );

  const setStatus = async (m, status) => {
    const patch = { status };
    if (status === 'received') patch.received_at = today;
    await updateMaterial(m.id, patch);
  };

  /**
   * Клик по показателю: несколько позиций — список с уже применённым фильтром,
   * одна — сразу карточка её заказа (правка 14).
   */
  const openKpi = (key) => {
    const rows = key === 'all' ? allRows : allRows.filter((r) => r.group === key);
    if (rows.length === 1) {
      navigate(...orderLinkTarget(rows[0].order.id, location));
      return;
    }
    setTab(key);
    setPage(1);
  };

  return (
    <>
      <PageHead title="Закупка" sub="Работа с материалами и поставщиками." />
      <DictionaryDatalist kind="supplier" id="erp-suppliers-table" />

      {/* Очередь участка идёт ПЕРВОЙ: это ответ на вопрос «что делать сейчас».
          Таблица закупочных строк ниже — справочник состояний, и до 12.08
          она была единственным содержимым экрана, из-за чего заказ без
          заведённых материалов не показывался вовсе */}
      {loaded && (
        <SupplyQueue
          orders={supplyOrders}
          supplyDept={supplyDept}
          onTake={takeSupply}
          onClose={closeSupply}
          onAddMaterial={(orderId) => setAdding({ orderId })}
        />
      )}

      {loaded && (
        <div className={styles.dashKpis} style={{ marginBottom: 16 }}>
          {KPIS.map((k) => {
            const val = counts[k.key];
            const active = tab === k.key;
            return (
              <button
                key={k.key}
                type="button"
                aria-pressed={active}
                title={k.hint}
                className={`${styles.kpiCard} ${styles.kpiCardClickable} ${active ? styles.kpiCardActive : ''}`}
                onClick={() => openKpi(k.key)}
              >
                <span className={`${styles.kpiIcon} ${k.cls ? styles[k.cls] : ''}`}><Icon name={k.icon} size={20} /></span>
                <span className={styles.kpiBody}>
                  <span className={styles.kpiCardLabel}>{k.label}</span>
                  <span className={styles.kpiCardValue}>{val}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {tab !== 'all' && (
        <div className={styles.toolbar} style={{ marginTop: -8 }}>
          <span className={`${styles.chip} ${styles.chipProgress}`}>
            Фильтр: {TABS.find((t) => t.key === tab)?.label}
          </span>
          <Button variant="ghost" onClick={() => setTab('all')}>
            Сбросить фильтр
          </Button>
        </div>
      )}

      <FilterBar
        search={query} onSearch={(v) => { setQuery(v); setPage(1); }}
        searchPlaceholder="Поиск: заказ, № сделки, материал, артикул, поставщик"
        searchLabel="Поиск по закупке"
        right={<Button variant="primary" onClick={() => setAdding(true)}>+ Новая закупка</Button>}
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

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="закупку" />}
      {!loadError && loading && !loaded && <TableSkeleton rows={8} label="Загрузка закупки" />}
      {loaded && filtered.length === 0 && (
        <div className={styles.emptyState}>Закупочных строк не найдено.</div>
      )}

      {loaded && filtered.length > 0 && (
        <>
          <ScrollHintBox className={styles.tableWrap} label="Закупка материалов">
            <table className={styles.table}>
              <thead>
                {/*
                  Две группы колонок — прямое требование документа (п. 12):
                  «в интерфейсе закупки необходимо визуально разделить исходный
                  запрос и данные закупщика». Слева то, что задал менеджер при
                  создании заказа, справа то, что закупщик выясняет и вносит сам.
                  Пока группы не были названы, обе роли писали в общую строку,
                  и «нужно было 100 м → закупили 110» показать было нечем.
                */}
                <tr className={styles.groupHeadRow}>
                  <th className={styles.groupHead} colSpan={4}>Потребность — задал менеджер</th>
                  <th className={styles.groupHead} colSpan={6}>Факт — ведёт закупка</th>
                </tr>
                <tr>
                  <SortableTh sortKey="order" sort={sort} onSort={sortBy}>№ заказа</SortableTh>
                  <SortableTh sortKey="material" sort={sort} onSort={sortBy}>Материал</SortableTh>
                  <SortableTh sortKey="plan" sort={sort} onSort={sortBy} label="План">Нужно</SortableTh>
                  <th>Комментарий менеджера</th>
                  <SortableTh sortKey="supplier" sort={sort} onSort={sortBy}>Поставщик</SortableTh>
                  <SortableTh sortKey="article" sort={sort} onSort={sortBy}>Артикул</SortableTh>
                  <SortableTh sortKey="received" sort={sort} onSort={sortBy}>Приход</SortableTh>
                  <th>Ответственный</th>
                  <SortableTh sortKey="status" sort={sort} onSort={sortBy}>Статус</SortableTh>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ order, m }) => (
                  <tr key={m.id}>
                    <td>
                      {/* Правка 10: номер заказа — ссылка на его карточку */}
                      <OrderLink
                        orderId={order.id}
                        title={`Открыть заказ №${order.bitrix_id || '—'}`}
                      >
                        №{order.bitrix_id || '—'}
                      </OrderLink>
                      <div className={styles.cellSub} title={order.title}>{order.title}</div>
                    </td>
                    <td>
                      <strong>{m.name}</strong>
                      <div className={styles.subText}>{KIND_LABELS[m.kind]}{m.color ? ` · ${m.color}` : ''}{m.source !== 'purchase' ? ` · ${SOURCE_LABELS[m.source]}` : ''}</div>
                    </td>
                    <td>
                      <input
                        type="number" min="0" step="0.01" className={`${styles.input} ${styles.inputSm}`}
                        defaultValue={m.qty_expected ?? ''} placeholder="—"
                        onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (m.qty_expected ?? null)) updateMaterial(m.id, { qty_expected: v }); }}
                        aria-label={`План ${m.name}`} style={{ maxWidth: 80 }}
                      />
                    </td>
                    <td>
                      {/* Комментарий МЕНЕДЖЕРА — на чтение: это исходное задание,
                          и правка его закупщиком стёрла бы то, что просили.
                          Свой комментарий закупщик пишет в приёмке. */}
                      <span className={m.manager_note ? undefined : styles.subText}>
                        {m.manager_note || '—'}
                      </span>
                    </td>
                    <td>
                      {/* Правка 10: поставщик — не одно поле, а выбор из вариантов */}
                      <button
                        type="button"
                        className={styles.supplierCell}
                        onClick={() => setOptionsFor({ material: m, order })}
                        title={`Варианты поставщиков: ${m.name}`}
                      >
                        <span className={m.supplier ? undefined : styles.subText}>
                          {m.supplier || 'не выбран'}
                        </span>
                        <span className={styles.subText}>
                          {(m.suppliers ?? []).length > 0
                            ? `${(m.suppliers ?? []).length} ${pluralize((m.suppliers ?? []).length, 'вариант', 'варианта', 'вариантов')}`
                            : 'добавить вариант'}
                        </span>
                      </button>
                    </td>
                    <td>
                      <input
                        className={`${styles.input} ${styles.inputSm}`} defaultValue={m.article || ''} placeholder="—"
                        onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (m.article || null)) updateMaterial(m.id, { article: v }); }}
                        aria-label={`Артикул ${m.name}`} style={{ maxWidth: 110 }}
                      />
                    </td>
                    <td>
                      {m.qty_received != null
                        ? `${m.qty_received}${m.unit ? ` ${m.unit}` : ''}`
                        : (m.received_at ? formatDateShort(m.received_at) : '—')}
                    </td>
                    <td>
                      {/* С кого спрашивать, пока материала нет. Показывается цеху
                          в карточке «Ожидают материалы» — accepted_by для этого
                          не годится: он заполняется уже после приёмки */}
                      <input
                        className={`${styles.input} ${styles.inputSm}`} defaultValue={m.responsible || ''} placeholder="—"
                        onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (m.responsible || null)) updateMaterial(m.id, { responsible: v }); }}
                        aria-label={`Ответственный за получение ${m.name}`} style={{ maxWidth: 120 }}
                      />
                    </td>
                    <td>
                      <Badge variant={STATUS_VARIANT[m.status] || 'neutral'}>{MATERIAL_STATUS_LABELS[m.status]}</Badge>
                      {(() => {
                        const sla = m.source === 'purchase' ? procurementSla(m.created_at, m.status) : null;
                        if (!sla) return null;
                        return (
                          <div className={styles.subText}>
                            {sla === 'overdue' ? (
                              <span className={styles.cellWithIcon}><Icon name="alert" size={13} /> просрочено</span>
                            ) : 'на обработке'}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      {m.source === 'stock' && m.status === 'pending' ? (
                        <Button
                          variant="secondary"
                          onClick={() => confirmStockMaterial(m.id)}>Наличие</Button>
                      ) : (
                        <select className={styles.select} value={m.status} onChange={(e) => setStatus(m, e.target.value)} aria-label={`Статус ${m.name}`}>
                          {Object.entries(MATERIAL_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollHintBox>
          <Pagination
            page={safePage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
            onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}

      {procurementRows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className={styles.fieldLabel}>Дозакупки / замены ({procurementRows.length})</div>
          <ScrollHintBox className={styles.tableWrap} label="Дозакупки и замены">
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableTh sortKey="order" sort={procSort} onSort={toggleProcSort} label="№ заказа">№</SortableTh>
                  <SortableTh sortKey="material" sort={procSort} onSort={toggleProcSort}>Материал</SortableTh>
                  <SortableTh sortKey="kind" sort={procSort} onSort={toggleProcSort}>Тип</SortableTh>
                  <SortableTh sortKey="cause" sort={procSort} onSort={toggleProcSort}>Причина</SortableTh>
                  <SortableTh sortKey="supplier" sort={procSort} onSort={toggleProcSort}>Поставщик</SortableTh>
                  <SortableTh sortKey="status" sort={procSort} onSort={toggleProcSort}>Статус</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedProcurement.map(({ order, t }) => (
                  <tr key={t.id}>
                    <td>
                      <OrderLink
                        orderId={order.id}
                        title={`Открыть заказ №${order.bitrix_id || '—'}`}
                      >
                        №{order.bitrix_id || '—'}
                      </OrderLink>
                    </td>
                    <td>{t.material_name}</td>
                    <td>{PROCUREMENT_KIND_LABELS[t.kind]}{!t.counts_as_purchase && <div className={styles.subText}>не закупка компании</div>}</td>
                    <td>{PROCUREMENT_CAUSE_LABELS[t.cause_type]}</td>
                    <td>{t.supplier || '—'}</td>
                    <td>
                      <select className={styles.select} value={t.status} onChange={(e) => updateProcurementTask(t.id, { status: e.target.value })} aria-label={`Статус задачи ${t.material_name}`}>
                        {Object.entries(PROCUREMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollHintBox>
        </div>
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
