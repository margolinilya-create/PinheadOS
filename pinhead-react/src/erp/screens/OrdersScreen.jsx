import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { deptShortName } from '../data/departments';
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
          <Link
            to={`/orders/${order.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'inherit', fontWeight: 700, textDecoration: 'none' }}
            title="Открыть карточку заказа"
          >
            {order.title} ↗
          </Link>
          {order.notes && order.notes !== 'imported' && (
            <div className={styles.subText}>{order.notes}</div>
          )}
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
                  title={`${deptById.get(st.department_id)?.name || '?'} · ${STAGE_STATUS_LABELS[st.status]}`}
                >
                  {(() => {
                    const dd = deptById.get(st.department_id);
                    return dd ? deptShortName(dd.code, dd.name) : '?';
                  })()}
                  {st.status === 'done' && ' ✓'}
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
  const uploadOrderPreview = useErpStore((s) => s.uploadOrderPreview);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  const acceptPreview = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('Превью: только JPG/PNG/WEBP');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Превью: файл больше 2 МБ');
      return;
    }
    setPreviewFile(file);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
  };

  // Ctrl+V из буфера (приём kontora24): вне текстовых полей
  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.type !== 'file') return;
      const file = [...(e.clipboardData?.files ?? [])][0];
      if (file) acceptPreview(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
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
    // Ступень 1: собрать все ошибки (error-summary как в kontora24)
    const errs = [];
    if (!form.title.trim()) errs.push('Укажите название заказа');
    items.forEach((it, i) => {
      const filled = it.product_type.trim() || it.variant.trim() || it.qty;
      if (!filled && items.length > 1) return; // пустую доп. строку пропускаем
      if (!it.product_type.trim()) errs.push(`Позиция ${i + 1}: укажите изделие`);
      if (!(Number(it.qty) > 0)) errs.push(`Позиция ${i + 1}: количество должно быть больше 0`);
    });
    const today = new Date().toISOString().slice(0, 10);
    if (form.due_date && form.due_date < today) {
      errs.push('Срок клиента в прошлом — проверьте дату');
    }
    if (errs.length > 0) {
      setFormErrors(errs);
      requestAnimationFrame(() => {
        document.querySelector('[data-form-errors]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    setFormErrors([]);
    const validItems = items.filter((it) => it.product_type.trim() && Number(it.qty) > 0);
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
    if (created && previewFile) {
      await uploadOrderPreview(created.id, previewFile);
    }
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
        noValidate
        aria-label="Новый производственный заказ"
      >
        <div className={styles.modalTitle}>Новый заказ</div>

        {formErrors.length > 0 && (
          <div className={styles.errorSummary} data-form-errors role="alert">
            <strong>Исправьте перед созданием:</strong>
            <ul>
              {formErrors.map((er) => <li key={er}>{er}</li>)}
            </ul>
          </div>
        )}

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
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Тип производства</span>
              <div className={styles.tileRow} role="radiogroup" aria-label="Тип производства">
                {Object.entries(PRODUCTION_TYPE_LABELS).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={it.production_type === v}
                    className={`${styles.tile} ${it.production_type === v ? styles.tileActive : ''}`}
                    onClick={() => setItem(i, { production_type: v })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
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

        <div
          className={styles.dropZone}
          role="button"
          tabIndex={0}
          aria-label="Превью заказа: перетащите картинку, вставьте Ctrl+V или кликните"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click(); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); acceptPreview(e.dataTransfer.files?.[0]); }}
        >
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="Превью заказа" className={styles.dropZoneImg} />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewFile(null);
                  setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
                }}
              >
                ✕ Убрать
              </button>
            </>
          ) : (
            <span className={styles.subText}>
              🖼 Превью заказа: перетащите картинку сюда, вставьте <kbd>Ctrl+V</kbd> или кликните
              (JPG/PNG/WEBP до 2 МБ)
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => acceptPreview(e.target.files?.[0])}
          />
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
