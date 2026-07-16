import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import {
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  STAGE_STATUS_LABELS,
} from '../types';
import styles from '../erp.module.css';

const EMPTY_ITEM = {
  product_type: '',
  variant: '',
  qty: '',
  production_type: 'sewing',
  branding_methods: [],
  branding_on: 'cut',
};

function daysLeft(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function DueCell({ dueDate }) {
  const d = daysLeft(dueDate);
  if (d === null) return <span className={styles.subText}>—</span>;
  const cls = d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : undefined;
  return (
    <span className={cls}>
      {new Date(dueDate + 'T00:00:00').toLocaleDateString('ru-RU')}
      <span className={styles.subText}> ({d >= 0 ? `${d} дн.` : `просрочен ${-d} дн.`})</span>
    </span>
  );
}

const STAGE_CHIP_CLASS = {
  waiting: 'chipWaiting',
  ready: 'chipReady',
  in_progress: 'chipProgress',
  done: 'chipDone',
  skipped: 'chipSkipped',
  blocked: 'chipBlocked',
};

function OrderRow({ order, departments, onDelete, canDelete }) {
  const [open, setOpen] = useState(false);
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);

  return (
    <>
      <tr
        className={styles.rowClickable}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <td>{order.bitrix_id || '—'}</td>
        <td>
          <strong>{order.title}</strong>
          {order.notes && <div className={styles.subText}>{order.notes}</div>}
        </td>
        <td>{order.manager || '—'}</td>
        <td>{totalQty}</td>
        <td><DueCell dueDate={order.due_date} /></td>
        <td>
          <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {canDelete && (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`Удалить заказ ${order.title}`}
              onClick={() => onDelete(order)}
            >
              ✕
            </button>
          )}
        </td>
      </tr>
      {open && order.items.map((it) => (
        <tr key={it.id}>
          <td />
          <td colSpan={6}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{it.product_type}</strong>
              {it.variant && <span className={styles.subText}>{it.variant}</span>}
              <span>× {it.qty}</span>
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                {PRODUCTION_TYPE_LABELS[it.production_type]}
              </span>
              {it.branding_methods.map((m) => (
                <span key={m} className={`${styles.chip} ${styles.chipNeutral}`}>
                  {BRANDING_METHOD_LABELS[m]}
                </span>
              ))}
            </div>
            <div className={styles.stageChips} style={{ marginTop: 6 }}>
              {it.stages.map((st) => (
                <span
                  key={st.id}
                  className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[st.status]]}`}
                  title={STAGE_STATUS_LABELS[st.status]}
                >
                  {deptById.get(st.department_id)?.name || '?'}
                </span>
              ))}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function CreateOrderModal({ onClose }) {
  const createOrder = useErpStore((s) => s.createOrder);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    bitrix_id: '', title: '', manager: '', launch_date: '', due_date: '',
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const firstFieldRef = useRef(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  const setItem = (i, patch) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const toggleMethod = (i, method) =>
    setItems((arr) => arr.map((it, idx) => {
      if (idx !== i) return it;
      const has = it.branding_methods.includes(method);
      return {
        ...it,
        branding_methods: has
          ? it.branding_methods.filter((m) => m !== method)
          : [...it.branding_methods, method],
      };
    }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Укажите название заказа'); return; }
    const validItems = items.filter((it) => it.product_type.trim() && Number(it.qty) > 0);
    if (validItems.length === 0) {
      toast.error('Добавьте хотя бы одну позицию (изделие и количество)');
      return;
    }
    setSaving(true);
    const created = await createOrder({
      bitrix_id: form.bitrix_id.trim() || undefined,
      title: form.title.trim(),
      manager: form.manager.trim() || undefined,
      launch_date: form.launch_date || undefined,
      due_date: form.due_date || undefined,
      items: validItems.map((it) => ({
        product_type: it.product_type.trim(),
        variant: it.variant.trim() || undefined,
        qty: Number(it.qty),
        production_type: it.production_type,
        branding_methods: it.branding_methods,
        branding_on: it.branding_on,
      })),
    });
    setSaving(false);
    if (created) {
      toast.success(`Заказ «${created.title}» создан, маршрут построен`);
      onClose();
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="presentation">
      <form
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        aria-label="Новый производственный заказ"
      >
        <div className={styles.modalTitle}>Новый заказ</div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>№ сделки Bitrix</span>
            <input
              ref={firstFieldRef}
              className={styles.input}
              value={form.bitrix_id}
              onChange={(e) => setForm({ ...form, bitrix_id: e.target.value })}
              placeholder="54766"
            />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Название *</span>
            <input
              className={styles.input}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="BOX39 свитшоты"
              required
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Менеджер</span>
            <input
              className={styles.input}
              value={form.manager}
              onChange={(e) => setForm({ ...form, manager: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Дата запуска</span>
            <input
              type="date"
              className={styles.input}
              value={form.launch_date}
              onChange={(e) => setForm({ ...form, launch_date: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок клиента</span>
            <input
              type="date"
              className={styles.input}
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </label>
        </div>

        <div className={styles.fieldLabel}>Позиции (изделие × вариант × кол-во)</div>
        {items.map((it, i) => (
          <div key={i} className={styles.itemRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Изделие *</span>
              <input
                className={styles.input}
                value={it.product_type}
                onChange={(e) => setItem(i, { product_type: e.target.value })}
                placeholder="футболка"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Вариант / цвет</span>
              <input
                className={styles.input}
                value={it.variant}
                onChange={(e) => setItem(i, { variant: e.target.value })}
                placeholder="голубые"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Кол-во *</span>
              <input
                type="number"
                min="1"
                className={styles.input}
                value={it.qty}
                onChange={(e) => setItem(i, { qty: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Тип производства</span>
              <select
                className={styles.select}
                value={it.production_type}
                onChange={(e) => setItem(i, { production_type: e.target.value })}
              >
                {Object.entries(PRODUCTION_TYPE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Нанесения</span>
              <div className={styles.checkRow}>
                {Object.entries(BRANDING_METHOD_LABELS).map(([v, label]) => (
                  <label key={v} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={it.branding_methods.includes(v)}
                      onChange={() => toggleMethod(i, v)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Нанесение на</span>
              <select
                className={styles.select}
                value={it.branding_on}
                onChange={(e) => setItem(i, { branding_on: e.target.value })}
              >
                <option value="cut">на крое</option>
                <option value="finished">на готовом</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="Убрать позицию"
              disabled={items.length === 1}
              onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setItems((arr) => [...arr, { ...EMPTY_ITEM }])}
          >
            + Добавить позицию
          </button>
        </div>

        <div className={styles.modalActions}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Создание…' : 'Создать заказ'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function OrdersScreen({ user }) {
  const { orders, departments, loading, loaded, loadAll, deleteOrder } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      deleteOrder: s.deleteOrder,
    })),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('active'); // active | archive

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  const canDelete = ['admin', 'director'].includes(user?.role);

  const inTab = useMemo(
    () => orders.filter((o) => (tab === 'active' ? o.status === 'active' : o.status !== 'active')),
    [orders, tab],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter(
      (o) =>
        o.title.toLowerCase().includes(q) ||
        (o.bitrix_id || '').includes(q) ||
        (o.manager || '').toLowerCase().includes(q),
    );
  }, [inTab, query]);

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

  return (
    <>
      <PageHead title="Заказы" sub="Производственные заказы: позиции, маршрут по цехам, сроки." />

      <div className={styles.toolbar}>
        <div role="tablist" aria-label="Фильтр заказов" style={{ display: 'flex', gap: 6 }}>
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
            Архив ({orders.filter((o) => o.status !== 'active').length})
          </button>
        </div>
        <input
          type="search"
          className={styles.input}
          placeholder="Поиск: название, № сделки, менеджер"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 260 }}
          aria-label="Поиск заказов"
        />
        <div className={styles.spacer} />
        <span className={styles.subText}>{filtered.length} из {inTab.length}</span>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Новый заказ
        </button>
      </div>

      {loading && !loaded && <div className={styles.emptyState}>Загрузка…</div>}

      {loaded && filtered.length === 0 && (
        <div className={styles.emptyState}>
          {inTab.length === 0
            ? tab === 'active'
              ? 'Активных заказов нет — создайте первый.'
              : 'Архив пуст.'
            : 'Ничего не найдено по запросу.'}
        </div>
      )}

      {filtered.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№ сделки</th>
                <th>Заказ</th>
                <th>Менеджер</th>
                <th>Кол-во</th>
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
