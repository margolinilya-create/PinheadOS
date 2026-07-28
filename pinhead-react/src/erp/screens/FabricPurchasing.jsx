import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { sortRows, useTableSort } from '../utils/tableSort';
import { useErpStore } from '../store/useErpStore';
import { orderLinkClick, useOrderDrawer } from '../store/useOrderDrawer';
import { toast } from '../../store/useToastStore';
import { pluralize } from '../../utils/i18n';
import { SupplierOptionsModal } from './purchasing/SupplierOptionsModal';
import { formatDateShort, procurementSla } from '../utils/time';
import {
  MATERIAL_STATUS_LABELS,
  PROCUREMENT_CAUSE_LABELS,
  PROCUREMENT_KIND_LABELS,
  PROCUREMENT_STATUS_LABELS,
} from '../types';
import styles from '../erp.module.css';

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
  color: '', article: '', qty: '', qty_expected: '', eta_date: '',
};

/** Модалка «Новая закупка» */
function AddPurchaseModal({ orders, onAdd, onClose }) {
  // Без трапа Tab уходил под оверлей, а Escape не закрывал — при объявленном aria-modal
  const trapRef = useFocusTrap(true, onClose);
  const [form, setForm] = useState(EMPTY_MAT);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.order_id) { toast.error('Выберите заказ'); return; }
    if (!form.name.trim()) { toast.error('Укажите материал'); return; }
    if (form.source === 'purchase' && !form.eta_date) { toast.error('Укажите план прихода'); return; }
    if (form.source === 'purchase' && (!form.qty_expected || Number(form.qty_expected) <= 0)) {
      toast.error('Укажите плановое кол-во (кг)'); return;
    }
    setSaving(true);
    const row = await onAdd(form.order_id, {
      kind: form.kind, name: form.name.trim(), source: form.source,
      supplier: form.supplier.trim() || null, color: form.color.trim() || null,
      article: form.article.trim() || null, qty: form.qty.trim() || null,
      qty_expected: form.qty_expected === '' ? null : Number(form.qty_expected),
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
          <label className={styles.field}>
            <span className={styles.fieldLabel}>План, кг</span>
            <input type="number" min="0" step="0.01" className={styles.input} value={form.qty_expected} onChange={(e) => set({ qty_expected: e.target.value })} aria-label="Плановое количество" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>План прихода</span>
            <DateField presets value={form.eta_date} onChange={(v) => set({ eta_date: v })} aria-label="План прихода" />
          </label>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>Добавить</button>
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
  { key: 'all', icon: '🗂️', cls: '', label: 'Всего строк', hint: 'Показать все закупки без фильтра' },
  { key: 'awaiting', icon: '⏳', cls: 'kpiIconWarn', label: 'Ожидается', hint: 'Позиции, ожидающие заказа или обработки' },
  { key: 'transit', icon: '🚚', cls: '', label: 'В пути', hint: 'Отправленные, но ещё не поступившие позиции' },
  { key: 'arrived', icon: '✅', cls: 'kpiIconOk', label: 'Пришло', hint: 'Поступившие позиции' },
  { key: 'overdue', icon: '⚠️', cls: 'kpiIconDanger', label: 'Просрочено', hint: 'Просроченные позиции' },
];

export default function FabricPurchasing() {
  const {
    orders, loading, loaded, loadError, loadAll, addMaterial, updateMaterial,
    confirmStockMaterial, updateProcurementTask,
    addSupplierOption, updateSupplierOption, selectSupplierOption, deleteSupplierOption,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders, loading: s.loading, loaded: s.loaded, loadError: s.loadError,
      loadAll: s.loadAll, addMaterial: s.addMaterial, updateMaterial: s.updateMaterial,
      confirmStockMaterial: s.confirmStockMaterial, updateProcurementTask: s.updateProcurementTask,
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
  const [adding, setAdding] = useState(false);
  /** Открытая модалка сравнения вариантов поставщика: { material, order } */
  const [optionsFor, setOptionsFor] = useState(null);
  const { sort, toggle: toggleSort } = useTableSort();
  const { sort: procSort, toggle: toggleProcSort } = useTableSort();
  const today = new Date().toISOString().slice(0, 10);

  // Смена сортировки возвращает на первую страницу: иначе человек нажимает
  // «по сроку» и остаётся на пятой странице уже другого списка
  const sortBy = (key) => { toggleSort(key); setPage(1); };

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const activeOrders = useMemo(() => orders.filter((o) => o.status === 'active'), [orders]);

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
      useOrderDrawer.getState().open(rows[0].order.id);
      return;
    }
    setTab(key);
    setPage(1);
  };

  return (
    <>
      <PageHead title="Закупка" sub="Работа с материалами и поставщиками." />
      <DictionaryDatalist kind="supplier" id="erp-suppliers-table" />

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
                <span className={`${styles.kpiIcon} ${k.cls ? styles[k.cls] : ''}`}>{k.icon}</span>
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
          <button type="button" className="btn btn-ghost" onClick={() => setTab('all')}>
            Сбросить фильтр
          </button>
        </div>
      )}

      <FilterBar
        search={query} onSearch={(v) => { setQuery(v); setPage(1); }}
        searchPlaceholder="Поиск: заказ, № сделки, материал, артикул, поставщик"
        searchLabel="Поиск по закупке"
        right={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Новая закупка</button>}
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
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableTh sortKey="order" sort={sort} onSort={sortBy}>№ заказа</SortableTh>
                  <SortableTh sortKey="material" sort={sort} onSort={sortBy}>Материал</SortableTh>
                  <SortableTh sortKey="supplier" sort={sort} onSort={sortBy}>Поставщик</SortableTh>
                  <SortableTh sortKey="article" sort={sort} onSort={sortBy}>Артикул</SortableTh>
                  <SortableTh sortKey="plan" sort={sort} onSort={sortBy} label="План">План, кг</SortableTh>
                  <SortableTh sortKey="received" sort={sort} onSort={sortBy}>Приход</SortableTh>
                  <SortableTh sortKey="status" sort={sort} onSort={sortBy}>Статус</SortableTh>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ order, m }) => (
                  <tr key={m.id}>
                    <td>
                      {/* Правка 10: номер заказа — ссылка на его карточку */}
                      <Link
                        to={`/orders/${order.id}`}
                        onClick={(e) => orderLinkClick(order.id, e)}
                        title={`Открыть заказ №${order.bitrix_id || '—'}`}
                      >
                        №{order.bitrix_id || '—'}
                      </Link>
                      <div className={styles.cellSub} title={order.title}>{order.title}</div>
                    </td>
                    <td>
                      <strong>{m.name}</strong>
                      <div className={styles.subText}>{KIND_LABELS[m.kind]}{m.color ? ` · ${m.color}` : ''}{m.source !== 'purchase' ? ` · ${SOURCE_LABELS[m.source]}` : ''}</div>
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
                      <input
                        type="number" min="0" step="0.01" className={`${styles.input} ${styles.inputSm}`}
                        defaultValue={m.qty_expected ?? ''} placeholder="—"
                        onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (m.qty_expected ?? null)) updateMaterial(m.id, { qty_expected: v }); }}
                        aria-label={`План ${m.name}`} style={{ maxWidth: 80 }}
                      />
                    </td>
                    <td>
                      {m.qty_received != null ? `${m.qty_received} кг` : (m.received_at ? formatDateShort(m.received_at) : '—')}
                    </td>
                    <td>
                      <Badge variant={STATUS_VARIANT[m.status] || 'neutral'}>{MATERIAL_STATUS_LABELS[m.status]}</Badge>
                      {(() => {
                        const sla = m.source === 'purchase' ? procurementSla(m.created_at, m.status) : null;
                        if (!sla) return null;
                        return <div className={styles.subText}>{sla === 'overdue' ? '⚠️ просрочено' : 'на обработке'}</div>;
                      })()}
                    </td>
                    <td>
                      {m.source === 'stock' && m.status === 'pending' ? (
                        <button type="button" className="btn btn-secondary" onClick={() => confirmStockMaterial(m.id)}>Наличие</button>
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
          </div>
          <Pagination
            page={safePage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
            onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}

      {procurementRows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className={styles.fieldLabel}>Дозакупки / замены ({procurementRows.length})</div>
          <div className={styles.tableWrap}>
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
                      <Link
                        to={`/orders/${order.id}`}
                        onClick={(e) => orderLinkClick(order.id, e)}
                        title={`Открыть заказ №${order.bitrix_id || '—'}`}
                      >
                        №{order.bitrix_id || '—'}
                      </Link>
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
          </div>
        </div>
      )}

      {adding && (
        <AddPurchaseModal orders={activeOrders} onAdd={addMaterial} onClose={() => setAdding(false)} />
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
