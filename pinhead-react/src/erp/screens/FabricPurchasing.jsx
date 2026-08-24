import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { PreliminarySection } from './purchasing/PreliminarySection';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useCompactLayout } from '../layout/useCompactLayout';
import { PurchaseRowCard } from './purchasing/PurchaseRowCard';
import {
  ArticleField, CostValue, EtaField, ManagerNote, MaterialCell, OrderCell,
  OrderedOnField, PlanField, PriceField, QtyOrderedField, ReceivedValue,
  ResponsibleField, StatusCell, StatusControl, SupplierCell,
} from './purchasing/PurchaseFields';
import { KIND_LABELS, PURCHASE_GROUPS, SOURCE_LABELS } from './purchasing/purchaseLabels';
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
import { toast } from '../../store/useToastStore';
import { SupplierOptionsModal } from './purchasing/SupplierOptionsModal';
import { useStagePermissions } from '../store/useStagePermissions';
import { SupplyQueue } from './purchasing/SupplyQueue';
import { PurchaseCard, PurchaseCardEmpty } from './purchasing/PurchaseCard';
import { findSupplyDept, ordersAwaitingSupply } from '../utils/supply';
import {
  MATERIAL_STATUS_LABELS,
  PROCUREMENT_CAUSE_LABELS,
  PROCUREMENT_KIND_LABELS,
  PROCUREMENT_STATUS_LABELS,
} from '../types';
import styles from '../styles';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Button } from '../components/Button';
import { factoryToday } from '../../utils/date';

/**
 * Закупка (редизайн): плоская таблица закупочных строк по всем активным заказам
 * (KPI-плитки + фильтр по статусу + пагинация), инлайн-правки план/цвет/артикул/статус,
 * «Новая закупка» — модалка добавления материала. Дозакупки/замены — секцией ниже.
 * Бизнес-логика (addMaterial/updateMaterial/confirmStockMaterial/procurement) не менялась.
 */

/* Подписи (KIND_LABELS, SOURCE_LABELS, STATUS_VARIANT, PURCHASE_GROUPS) переехали
   в `purchasing/purchaseLabels`, содержимое колонок — в `purchasing/PurchaseFields`:
   и то и другое читают обе раскладки строки закупки — таблица и карточка. */

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
  // Факт закупщика (документ 20.08, п. 4): сколько заказал и когда
  qty_ordered: '', ordered_on: '',
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
      qty_ordered: form.qty_ordered === '' ? null : Number(form.qty_ordered),
      ordered_on: form.ordered_on || null,
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
          {/* Факт закупщика (документ 20.08, п. 4). Заводя строку, он уже знает,
              сколько заказал и когда: спрашивать это потом отдельным заходом
              значит гарантировать, что поле останется пустым */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Заказано</span>
            <input
              type="number" min="0" step="any" className={styles.input}
              value={form.qty_ordered}
              onChange={(e) => set({ qty_ordered: e.target.value.replace('-', '') })}
              aria-label="Сколько заказано"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Дата заказа</span>
            <DateField
              value={form.ordered_on}
              onChange={(v) => set({ ordered_on: v })}
              aria-label="Дата заказа"
            />
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
  /**
   * Ниже 1024px (и на любом тач-устройстве) — карточки вместо таблицы.
   * У закупки колонок ЧЕТЫРНАДЦАТЬ: на планшете это прокрутка на три экрана,
   * а «Закупка» входит в пилот наравне со «Складом».
   */
  const isCompact = useCompactLayout();
  const today = factoryToday();
  // Контекст экрана — в адресе: выбранный заказ (`?supply=`) переживает возврат
  // из карточки заказа, и ссылкой на конкретную закупку можно поделиться
  const [params, setParams] = useSearchParams();

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
  /**
   * Права спрашиваются ПО ДЕЙСТВИЮ и по цеху закупки — так же, как в очереди
   * цеха. Без прав карточка остаётся на чтение: видеть свою закупку важно
   * и тому, кто в ней не работает (менеджер заказа).
   */
  const supplyPerms = useStagePermissions(supplyDept?.id ?? null);

  /**
   * ЗАВЕРШЁННЫЕ ЗАКУПКИ (п. 1.5–1.6). Активная очередь показывает только
   * незакрытое — «после действия „Завершить закупку" заказ автоматически
   * скрывается из основной рабочей очереди». Но данные не удаляются:
   * «сохраняются материалы, поставщики, артикулы, количества, цены, даты,
   * документы, комментарии и история действий».
   *
   * Отсюда второй список, СВЁРНУТЫЙ по умолчанию («архив по умолчанию
   * скрыт»): заказы с заведёнными материалами, у которых открытых этапов
   * закупки уже нет. Без него материалы закрытых заказов стали бы
   * недостижимы вовсе — их таблица раньше показывала общим списком.
   */
  const doneOrders = useMemo(() => {
    const openIds = new Set(supplyOrders.map((o) => o.id));
    return activeOrders.filter((o) => !openIds.has(o.id) && (o.materials?.length ?? 0) > 0);
  }, [activeOrders, supplyOrders]);
  const selectableOrders = useMemo(
    () => [...supplyOrders, ...doneOrders], [supplyOrders, doneOrders]);

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

  /**
   * ВЫБРАННЫЙ ЗАКАЗ ЖИВЁТ В АДРЕСЕ (`?supply=`), правка 23.08, п. 1.
   *
   * Экран стал мастер-деталью: сверху список-навигация, ниже карточка закупки
   * выбранного заказа. Состояние такого выбора — контекст списка, а контекст
   * в проекте живёт в URL: иначе ссылку на конкретную закупку нельзя переслать,
   * а возврат из карточки заказа открывал бы пустой экран.
   *
   * Пропавший из активной очереди заказ (закупку завершили) выбор снимает сам:
   * карточка закрытой закупки в активном разделе — ровно тот шум, от которого
   * уходит п. 1.5.
   */
  const requestedId = params.get('supply');
  const selectedOrder = useMemo(
    () => selectableOrders.find((o) => o.id === requestedId) ?? null,
    [selectableOrders, requestedId],
  );
  const selectOrder = (id) => {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (!id || id === out.get('supply')) out.delete('supply'); else out.set('supply', id);
      return out;
    }, { replace: true });
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => {
      // Карточка показывает материалы ТОЛЬКО своего заказа (п. 1.4): общая
      // таблица всех заказов и была второй рабочей зоной, на которую жалоба
      if (selectedOrder && r.order.id !== selectedOrder.id) return false;
      if (tab !== 'all' && r.group !== tab) return false;
      if (!q) return true;
      return r.order.title.toLowerCase().includes(q)
        || (r.order.bitrix_id || '').includes(q)
        || r.m.name.toLowerCase().includes(q)
        || (r.m.article || '').toLowerCase().includes(q)
        || (r.m.supplier || '').toLowerCase().includes(q);
    });
  }, [allRows, tab, query, selectedOrder]);

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

  /** Сброс подбора для «ничего не найдено» — и поиск, и вкладка сразу */
  const resetFilters = () => { setQuery(''); setTab('all'); setPage(1); };



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
          today={today}
          selectedId={selectedOrder?.id ?? null}
          onSelect={selectOrder}
        />
      )}

      {/* Предварительная закупка (п. 17): исключение при сжатых сроках,
          поэтому блок свёрнут и стоит ПОСЛЕ очереди участка — она отвечает
          на вопрос «что делать сейчас» */}
      {loaded && <PreliminarySection orders={orders} />}

      {/*
        КАРТОЧКА ЗАКУПКИ выбранного заказа (п. 1). Пока заказ не выбран —
        подсказка, что делать: пустой экран под списком читался бы как поломка.
      */}
      {loaded && !selectedOrder && supplyOrders.length > 0 && <PurchaseCardEmpty />}

      {/*
        ПЛИТКИ-ПОКАЗАТЕЛИ ЭКРАНА СНЯТЫ (правка 23.08, п. 1.3). Они были вторым
        видом ТОГО ЖЕ фильтра, что чипы в панели ниже (ключи совпадали
        до одного), и заодно тем самым «общим статусом материалов ниже
        по экрану», на который жалуется документ. Статус теперь показывает
        сводка КАРТОЧКИ выбранного заказа — сразу под шапкой, без прокрутки.
      */}
      {loaded && selectedOrder && (
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
      {/* Скелетон — на `!loaded && !loadError`, а не на `loading`: при сбое
          `loading` уже false, и экран замирал бы навсегда (правило UX-2) */}
      {!loadError && !loaded && <TableSkeleton rows={8} label="Загрузка закупки" />}

      {/* «Закупать нечего» и «подбор всё отсеял» — разные ответы: в первом
          случае человеку нечего сбрасывать, во втором сброс и есть выход */}
      {loaded && filtered.length === 0 && allRows.length === 0 && (
        <EmptyState
          icon="inbox"
          title="Закупочных строк нет"
          text="Лист закупки задаёт менеджер при создании заказа. Отдельную позицию можно завести кнопкой «Новая закупка»."
        />
      )}
      {loaded && filtered.length === 0 && allRows.length > 0 && (
        <EmptyResult query={query.trim()} onReset={resetFilters} resetLabel="Сбросить всё" />
      )}

      {loaded && filtered.length > 0 && isCompact && (
        <div className={styles.dataCardList}>
          {pageRows.map(({ order, m }) => (
            <PurchaseRowCard
              key={m.id}
              order={order}
              m={m}
              onUpdate={updateMaterial}
              onOpenOptions={setOptionsFor}
              onConfirmStock={confirmStockMaterial}
              onSetStatus={setStatus}
            />
          ))}
        </div>
      )}

      {loaded && filtered.length > 0 && !isCompact && (
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
                {/* colSpan считаются по колонкам ниже: 4 + 11 = 15. Стояло
                    4 + 10 — группа «Факт» была на колонку короче строки,
                    и её разделитель не доходил до «Действия» */}
                <tr className={styles.groupHeadRow}>
                  <th className={styles.groupHead} colSpan={4}>{PURCHASE_GROUPS[0].label}</th>
                  <th className={styles.groupHead} colSpan={11}>{PURCHASE_GROUPS[1].label}</th>
                </tr>
                <tr>
                  <SortableTh sortKey="order" sort={sort} onSort={sortBy}>№ заказа</SortableTh>
                  <SortableTh sortKey="material" sort={sort} onSort={sortBy}>Материал</SortableTh>
                  <SortableTh sortKey="plan" sort={sort} onSort={sortBy} label="План">Нужно</SortableTh>
                  <th>Комментарий менеджера</th>
                  <SortableTh sortKey="supplier" sort={sort} onSort={sortBy}>Поставщик</SortableTh>
                  <SortableTh sortKey="article" sort={sort} onSort={sortBy}>Артикул</SortableTh>
                  {/* Факт закупщика (документ 20.08, п. 4): «сколько фактически
                      заказано · цена за единицу · фактическая стоимость закупки ·
                      дата заказа · плановая дата прихода». Колонки в БД были
                      с 16.08, но не выведены НИ В ОДИН экран */}
                  <th>Заказано</th>
                  <th>Цена за ед.</th>
                  <th>Стоимость</th>
                  <th>Дата заказа</th>
                  <th>План прихода</th>
                  <SortableTh sortKey="received" sort={sort} onSort={sortBy}>Приход</SortableTh>
                  <th>Ответственный</th>
                  <SortableTh sortKey="status" sort={sort} onSort={sortBy}>Статус</SortableTh>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {/* Содержимое ячеек — из PurchaseFields, теми же элементами,
                    что рисует карточка планшета. Две реализации инлайн-правки
                    разошлись бы молча: обе «работают», просто пишут по-разному */}
                {pageRows.map(({ order, m }) => (
                  <tr key={m.id}>
                    <td><OrderCell order={order} /></td>
                    <td><MaterialCell m={m} /></td>
                    <td><PlanField m={m} onUpdate={updateMaterial} /></td>
                    <td><ManagerNote m={m} /></td>
                    <td><SupplierCell m={m} order={order} onOpenOptions={setOptionsFor} /></td>
                    <td><ArticleField m={m} onUpdate={updateMaterial} /></td>
                    <td><QtyOrderedField m={m} onUpdate={updateMaterial} /></td>
                    <td><PriceField m={m} onUpdate={updateMaterial} /></td>
                    <td className={styles.progressCell}><CostValue m={m} /></td>
                    <td><OrderedOnField m={m} onUpdate={updateMaterial} /></td>
                    <td><EtaField m={m} onUpdate={updateMaterial} /></td>
                    <td><ReceivedValue m={m} /></td>
                    <td><ResponsibleField m={m} onUpdate={updateMaterial} /></td>
                    <td><StatusCell m={m} /></td>
                    <td>
                      <StatusControl
                        m={m}
                        onConfirmStock={confirmStockMaterial}
                        onSetStatus={setStatus}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollHintBox>
        </>
      )}

      {/* Пагинация одна на обе раскладки: страница и её размер — свойство
          подбора, а не таблицы */}
      {loaded && filtered.length > 0 && (
        <Pagination
          page={safePage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
        />
      )}
        </PurchaseCard>
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

      {/*
        ЗАВЕРШЁННЫЕ ЗАКУПКИ — ВНИЗУ СТРАНИЦЫ И СВЁРНУТЫ (правка 24.08, п. 2:
        «внизу страницы оставить компактный блок „Завершённые закупки (N)"
        с кнопкой „Показать"»). Прежде блок стоял сразу под активной очередью,
        то есть между ней и рабочей карточкой закупки.

        Заголовок вложенному списку НЕ передаётся: свой у него дублировал бы
        «Заказы в закупке» внутри архива — ровно то, на что жалоба.
      */}
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
