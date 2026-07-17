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
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../types';
import styles from '../erp.module.css';

const EMPTY_ITEM = {
  product_type: '',
  variant: '',
  qty: '',
  production_type: 'sewing',
  branding_methods: [],
  branding_on: 'cut',
  prints: [],
  size_grid: null,
};

const EMPTY_PRINT = {
  method: 'embroidery',
  zone: '',
  width_mm: '',
  height_mm: '',
  offset_note: '',
  pantone: '',
  comment: '',
};

/** Редактор размерной сетки: размеры колонками, цвета строками, сумма = тираж */
function SizeGridEditor({ grid, onChange }) {
  const sizes = grid?.sizes ?? [];
  const rows = grid?.rows ?? [];
  const set = (patch) => onChange({ sizes, rows, ...patch });

  return (
    <div className={styles.sizeGrid}>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Размеры (через запятую)</span>
        <input
          className={styles.input}
          style={{ flex: 1, minWidth: 180, minHeight: 32 }}
          placeholder="XS-S, M-L, XL-2XL"
          value={sizes.join(', ')}
          onChange={(e) =>
            set({ sizes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => set({ rows: [...rows, { color: '', sizes: {} }] })}
        >
          + Цвет
        </button>
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className={styles.checkRow}>
          <input
            className={styles.input}
            style={{ width: 130, minHeight: 32 }}
            placeholder="Цвет"
            value={row.color}
            aria-label={`Цвет ${ri + 1}`}
            onChange={(e) =>
              set({ rows: rows.map((r, i) => (i === ri ? { ...r, color: e.target.value } : r)) })}
          />
          {sizes.map((sz) => (
            <label key={sz} className={styles.checkLabel} style={{ gap: 3 }}>
              <span className={styles.subText}>{sz}</span>
              <input
                type="number"
                min="0"
                className={styles.input}
                style={{ width: 64, minHeight: 32 }}
                value={row.sizes[sz] ?? ''}
                aria-label={`${row.color || 'цвет'} ${sz}`}
                onChange={(e) =>
                  set({
                    rows: rows.map((r, i) =>
                      i === ri
                        ? { ...r, sizes: { ...r.sizes, [sz]: Number(e.target.value) || 0 } }
                        : r),
                  })}
              />
            </label>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Убрать цвет"
            onClick={() => set({ rows: rows.filter((_, i) => i !== ri) })}
          >
            ✕
          </button>
        </div>
      ))}
      {rows.length > 0 && (
        <div className={styles.subText}>
          Итого по сетке:{' '}
          <strong>
            {rows.reduce((s, r) => s + Object.values(r.sizes).reduce((a, b) => a + b, 0), 0)} шт
          </strong>{' '}
          — подставится в количество позиции
        </div>
      )}
    </div>
  );
}

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
    packaging: 'none', packaging_note: '', stickers: 'none', stickers_note: '',
    no_chestny_znak: false,
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const firstFieldRef = useRef(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  const setItem = (i, patch) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const setPrint = (i, pi, patch) =>
    setItems((arr) => arr.map((it, idx) =>
      idx === i
        ? { ...it, prints: it.prints.map((p, j) => (j === pi ? { ...p, ...patch } : p)) }
        : it));

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
      packaging: form.packaging,
      packaging_note: form.packaging === 'other' ? form.packaging_note.trim() || undefined : undefined,
      stickers: form.stickers,
      stickers_note: form.stickers === 'other' ? form.stickers_note.trim() || undefined : undefined,
      no_chestny_znak: form.no_chestny_znak,
      items: validItems.map((it) => ({
        product_type: it.product_type.trim(),
        variant: it.variant.trim() || undefined,
        qty: Number(it.qty),
        production_type: it.production_type,
        // маршрут строится по техникам из блоков «Нанесение №N»
        branding_methods: [...new Set(it.prints.map((p) => p.method))],
        branding_on: it.branding_on,
        size_grid:
          it.size_grid?.rows?.length
            ? it.size_grid.rows
                .filter((r) => r.color.trim() || Object.keys(r.sizes).length)
                .map((r) => ({ color: r.color.trim() || '—', sizes: r.sizes }))
            : null,
        prints: it.prints.map((p) => ({
          method: p.method,
          zone: p.zone.trim() || undefined,
          width_mm: Number(p.width_mm) || null,
          height_mm: Number(p.height_mm) || null,
          offset_note: p.offset_note.trim() || undefined,
          pantone: p.pantone.trim() || undefined,
          comment: p.comment.trim() || undefined,
        })),
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
          <div key={i} className={styles.itemBlock}>
          <div className={styles.itemRow}>
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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setItem(i, { prints: [...it.prints, { ...EMPTY_PRINT }] })}
              >
                + Нанесение ({it.prints.length})
              </button>
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

          {it.prints.map((p, pi) => (
            <div key={pi} className={styles.printBlock}>
              <div className={styles.checkRow}>
                <strong className={styles.fieldLabel}>Нанесение №{pi + 1}</strong>
                <select
                  className={styles.select}
                  style={{ minHeight: 32 }}
                  value={p.method}
                  aria-label="Техника нанесения"
                  onChange={(e) => setPrint(i, pi, { method: e.target.value })}
                >
                  {Object.entries(BRANDING_METHOD_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 160, minHeight: 32 }}
                  placeholder="Расположение (спина справа по втачке)"
                  value={p.zone}
                  onChange={(e) => setPrint(i, pi, { zone: e.target.value })}
                />
                <label className={styles.checkLabel} style={{ gap: 3 }}>
                  <span className={styles.subText}>В, мм</span>
                  <input type="number" min="1" className={styles.input}
                    style={{ width: 70, minHeight: 32 }}
                    value={p.height_mm}
                    onChange={(e) => setPrint(i, pi, { height_mm: e.target.value })} />
                </label>
                <label className={styles.checkLabel} style={{ gap: 3 }}>
                  <span className={styles.subText}>Ш, мм</span>
                  <input type="number" min="1" className={styles.input}
                    style={{ width: 70, minHeight: 32 }}
                    value={p.width_mm}
                    onChange={(e) => setPrint(i, pi, { width_mm: e.target.value })} />
                </label>
                <button type="button" className="btn btn-ghost" aria-label="Убрать нанесение"
                  onClick={() => setItem(i, { prints: it.prints.filter((_, j) => j !== pi) })}>
                  ✕
                </button>
              </div>
              <div className={styles.checkRow}>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 150, minHeight: 32 }}
                  placeholder="Отступ (10см от шва горловины)"
                  value={p.offset_note}
                  onChange={(e) => setPrint(i, pi, { offset_note: e.target.value })}
                />
                <input
                  className={styles.input}
                  style={{ width: 150, minHeight: 32 }}
                  placeholder="Pantone (1163, 1181)"
                  value={p.pantone}
                  onChange={(e) => setPrint(i, pi, { pantone: e.target.value })}
                />
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 150, minHeight: 32 }}
                  placeholder="Комментарий (макет как в сделке…)"
                  value={p.comment}
                  onChange={(e) => setPrint(i, pi, { comment: e.target.value })}
                />
              </div>
            </div>
          ))}

          <details className={styles.gridDetails}>
            <summary className={styles.subText}>Размерная сетка (цвет × размер)</summary>
            <SizeGridEditor
              grid={it.size_grid}
              onChange={(g) => {
                const total = (g.rows ?? []).reduce(
                  (s, r) => s + Object.values(r.sizes).reduce((a, b) => a + b, 0), 0);
                setItem(i, { size_grid: g, ...(total > 0 ? { qty: String(total) } : {}) });
              }}
            />
          </details>
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

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Упаковка</span>
            <div className={styles.tileRow} role="radiogroup" aria-label="Упаковка">
              {Object.entries(PACKAGING_LABELS).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={form.packaging === v}
                  className={`${styles.tile} ${form.packaging === v ? styles.tileActive : ''}`}
                  onClick={() => setForm({ ...form, packaging: v })}>
                  {l}
                </button>
              ))}
            </div>
            {form.packaging === 'other' && (
              <input className={styles.input} placeholder="Какая? (с дизайном…)"
                value={form.packaging_note}
                onChange={(e) => setForm({ ...form, packaging_note: e.target.value })} />
            )}
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Стикеры</span>
            <div className={styles.tileRow} role="radiogroup" aria-label="Стикеры">
              {Object.entries(STICKERS_LABELS).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={form.stickers === v}
                  className={`${styles.tile} ${form.stickers === v ? styles.tileActive : ''}`}
                  onClick={() => setForm({ ...form, stickers: v })}>
                  {l}
                </button>
              ))}
            </div>
            {form.stickers === 'other' && (
              <input className={styles.input} placeholder="Какие? (со смежными размерами…)"
                value={form.stickers_note}
                onChange={(e) => setForm({ ...form, stickers_note: e.target.value })} />
            )}
          </div>
          <label className={styles.checkLabel} style={{ alignSelf: 'end', minHeight: 40 }}>
            <input
              type="checkbox"
              checked={form.no_chestny_znak}
              onChange={(e) => setForm({ ...form, no_chestny_znak: e.target.checked })}
            />
            Без Честного знака
          </label>
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
