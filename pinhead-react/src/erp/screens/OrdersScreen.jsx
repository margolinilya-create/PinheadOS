import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useErpStore } from '../store/useErpStore';
import { deptShortName } from '../data/departments';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { daysLeft, isUrgent, isOverdue, formatDateShort } from '../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip, stageProgress } from '../utils/stageUi';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { pluralize } from '../../utils/i18n';
import {
  EMPTY_ITEM,
  EMPTY_PRINT,
  SIZE_PRESETS,
  SIZE_PRESET_LABELS,
  clearOrderDraft,
  effectiveQty,
  emptyOrderForm,
  gridToPayload,
  gridTotal,
  isFormEmpty,
  loadOrderDraft,
  localToday,
  saveOrderDraft,
  toggleSize,
  validateOrderForm,
} from '../utils/orderForm';
import {
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../types';
import styles from '../erp.module.css';

/** Редактор размерной сетки: пресеты-чипсы размеров, цвета строками, сумма = тираж */
function SizeGridEditor({ grid, onChange }) {
  const sizes = grid?.sizes ?? [];
  const rows = grid?.rows ?? [];
  const [preset, setPreset] = useState(() => {
    const inKids = sizes.some((s) => SIZE_PRESETS.kids.includes(s));
    const inAdult = sizes.some((s) => SIZE_PRESETS.adult.includes(s));
    return inKids && !inAdult ? 'kids' : 'adult';
  });
  const [customSize, setCustomSize] = useState('');
  const set = (patch) => onChange({ sizes, rows, ...patch });
  const total = gridTotal(grid);

  const onToggleSize = (sz) => {
    const g = toggleSize(grid, sz);
    // первая активация размера — сразу даём строку цвета для ввода количеств
    onChange(g.sizes.length > 0 && (g.rows?.length ?? 0) === 0
      ? { ...g, rows: [{ color: '', sizes: {} }] }
      : g);
  };

  const addCustom = () => {
    const v = customSize.trim();
    if (!v) return;
    if (!sizes.includes(v)) onToggleSize(v);
    setCustomSize('');
  };

  const presetSizes = preset === 'custom' ? [] : SIZE_PRESETS[preset];
  const shownSizes = [...presetSizes, ...sizes.filter((s) => !presetSizes.includes(s))];

  return (
    <div className={styles.sizeGrid}>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Шкала</span>
        <div className={styles.tileRow} role="radiogroup" aria-label="Шкала размеров">
          {Object.entries(SIZE_PRESET_LABELS).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={preset === v}
              className={`${styles.tile} ${styles.tileSm} ${preset === v ? styles.tileActive : ''}`}
              onClick={() => setPreset(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Размеры</span>
        <div className={styles.tileRow} aria-label="Размеры сетки">
          {shownSizes.map((sz) => (
            <button
              key={sz}
              type="button"
              aria-pressed={sizes.includes(sz)}
              className={`${styles.tile} ${styles.tileSm} ${sizes.includes(sz) ? styles.tileActive : ''}`}
              onClick={() => onToggleSize(sz)}
            >
              {sz}
            </button>
          ))}
          {shownSizes.length === 0 && (
            <span className={styles.subText}>Добавьте свой размер ниже</span>
          )}
        </div>
      </div>
      {preset === 'custom' && (
        <div className={styles.checkRow}>
          <input
            className={`${styles.input} ${styles.inputSm} ${styles.customSizeInput}`}
            placeholder="Размер (56, 4XL…)"
            aria-label="Свой размер"
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
            }}
          />
          <button type="button" className="btn btn-secondary" onClick={addCustom}>
            Добавить
          </button>
        </div>
      )}
      {sizes.length > 0 && (
        <div className={styles.checkRow}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => set({ rows: [...rows, { color: '', sizes: {} }] })}
          >
            + Цвет
          </button>
        </div>
      )}
      {sizes.length > 0 && rows.map((row, ri) => (
        <div key={ri} className={styles.checkRow}>
          <input
            className={`${styles.input} ${styles.inputSm} ${styles.colorInput}`}
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
                className={`${styles.input} ${styles.inputSm} ${styles.qtyCellInput}`}
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
      <div className={styles.subText} aria-live="polite">
        Сумма по сетке: <strong>{total} шт</strong>
        {total > 0 && ' — подставится в количество позиции'}
      </div>
    </div>
  );
}

/** Сворачиваемая секция формы: заголовок с chevron + краткое резюме, когда свёрнута */
function FormSection({ id, title, summary, open, onToggle, children }) {
  return (
    <section className={styles.accSection}>
      <button
        type="button"
        className={styles.accHeader}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className={styles.accChevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className={styles.accTitle}>{title}</span>
        {!open && summary && <span className={styles.accSummary}>{summary}</span>}
      </button>
      {open && <div id={id} className={styles.accBody}>{children}</div>}
    </section>
  );
}

/** Текст ошибки под полем (инлайн-валидация) */
function FieldError({ id, text }) {
  if (!text) return null;
  return <span id={id} className={styles.fieldError}>{text}</span>;
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

function OrderRow({ order, departments, onDelete, canDelete, onShip }) {
  const [open, setOpen] = useState(false);
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const ready = isOrderReadyToShip(order);

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
            className={styles.cellTitle}
            title={order.title}
          >
            {order.title} ↗
          </Link>
          {order.notes && order.notes !== 'imported' && (
            <div className={styles.subText}>{order.notes}</div>
          )}
        </td>
        <td>{order.manager || '—'}</td>
        <td>{totalQty}</td>
        <td>{formatDateShort(order.created_at) || '—'}</td>
        <td><DueCell dueDate={order.due_date} /></td>
        <td>
          {ready ? (
            <span className={`${styles.chip} ${styles.chipReady}`}>✅ Готов к отгрузке</span>
          ) : (
            <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          )}
          {order.shipped_at && (
            <div className={styles.subText}>
              отгружен {new Date(order.shipped_at).toLocaleDateString('ru-RU')}
            </div>
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {ready && (
            <button
              type="button"
              className={`btn btn-primary ${styles.shipBtn}`}
              onClick={() => onShip(order)}
            >
              🚚 Отгрузить
            </button>
          )}
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
          <td colSpan={7}>
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

/** Карточка заказа вместо строки таблицы (мобильный <760px) */
function OrderCardMobile({ order, departments, onDelete, canDelete, onShip }) {
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const progress = stageProgress(order.items.flatMap((it) => it.stages));
  const ready = isOrderReadyToShip(order);

  return (
    <article className={styles.orderCardM} aria-label={`Заказ ${order.title}`}>
      <div className={styles.orderCardMHead}>
        <Link to={`/orders/${order.id}`} className={styles.orderCardMTitle} title={order.title}>
          {order.title} ↗
        </Link>
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
      </div>
      <div className={styles.subText}>
        №{order.bitrix_id || '—'}
        {order.manager ? ` · ${order.manager}` : ''} · {totalQty} шт
        {order.created_at ? ` · создан ${formatDateShort(order.created_at)}` : ''}
      </div>
      <div className={styles.orderCardMMeta}>
        {ready ? (
          <span className={`${styles.chip} ${styles.chipReady}`}>✅ Готов к отгрузке</span>
        ) : (
          <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        )}
        {order.shipped_at && (
          <span className={styles.subText}>
            отгружен {new Date(order.shipped_at).toLocaleDateString('ru-RU')}
          </span>
        )}
        <DueCell dueDate={order.due_date} />
        {progress.total > 0 && (
          <span className={styles.progressCell} aria-label={`Этапов готово: ${progress.done} из ${progress.total}`}>
            {progress.done}/{progress.total}
          </span>
        )}
      </div>
      {ready && (
        <button
          type="button"
          className={`btn btn-primary ${styles.shipBtn}`}
          onClick={() => onShip(order)}
        >
          🚚 Отгрузить
        </button>
      )}
      {order.items.map((it) => (
        <div key={it.id} className={styles.orderCardMItem}>
          <span className={styles.subText}>{it.product_type} × {it.qty}</span>
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
      ))}
    </article>
  );
}

function CreateOrderModal({ onClose }) {
  const createOrder = useErpStore((s) => s.createOrder);
  const uploadOrderPreview = useErpStore((s) => s.uploadOrderPreview);
  const [saving, setSaving] = useState(false);
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
  // Дата запуска по умолчанию — сегодня; черновик восстанавливается из localStorage
  const initialLaunch = useMemo(() => localToday(), []);
  const [restoredDraft] = useState(() => loadOrderDraft());
  const [form, setForm] = useState(() => restoredDraft?.form ?? emptyOrderForm(initialLaunch));
  const [items, setItems] = useState(() => restoredDraft?.items ?? [{ ...EMPTY_ITEM }]);
  const [draftRestored, setDraftRestored] = useState(Boolean(restoredDraft));

  // Аккордеон-секции: все раскрыты по умолчанию
  const [open, setOpen] = useState({ main: true, items: true, extra: true });
  const toggleSection = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  // Инлайн-валидация: после первой попытки сабмита ошибки живут вместе с вводом
  const [submitted, setSubmitted] = useState(false);
  const validation = useMemo(() => validateOrderForm(form, items), [form, items]);
  const fieldErrors = submitted ? validation.errors : {};
  const err = (key) => fieldErrors[key];
  const inputCls = (key) => (err(key) ? `${styles.input} ${styles.inputError}` : styles.input);

  // Автосейв черновика (debounce 500 мс); пустая форма — черновик удаляется
  useEffect(() => {
    const t = setTimeout(() => {
      if (isFormEmpty(form, items, initialLaunch)) clearOrderDraft();
      else saveOrderDraft(form, items);
    }, 500);
    return () => clearTimeout(t);
  }, [form, items, initialLaunch]);

  const resetDraft = () => {
    clearOrderDraft();
    setForm(emptyOrderForm(initialLaunch));
    setItems([{ ...EMPTY_ITEM }]);
    setDraftRestored(false);
    setSubmitted(false);
  };

  // Закрытие (фон/крестик/Escape): пустая форма — сразу, иначе confirm
  const closingRef = useRef(false);
  const requestClose = async () => {
    if (saving || closingRef.current) return;
    if (isFormEmpty(form, items, initialLaunch)) {
      clearOrderDraft();
      onClose();
      return;
    }
    closingRef.current = true;
    const ok = await confirm({
      title: 'Закрыть форму заказа?',
      message: 'Заполненные поля сохранены как черновик — он восстановится при следующем открытии формы.',
      confirmLabel: 'Закрыть',
      cancelLabel: 'Продолжить редактирование',
    });
    closingRef.current = false;
    if (ok) {
      saveOrderDraft(form, items);
      onClose();
    }
  };

  // Focus-trap + Escape → requestClose (важно: до эффекта autofocus, чтобы фокус остался на первом поле)
  const trapRef = useFocusTrap(true, requestClose);
  const firstFieldRef = useRef(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  const setItem = (i, patch) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  // Брендирование: при включении сразу добавляется одна пустая строка нанесения
  const setBranding = (i, on) =>
    setItems((arr) => arr.map((it, idx) =>
      idx === i
        ? {
            ...it,
            has_branding: on,
            prints: on && it.prints.length === 0 ? [{ ...EMPTY_PRINT }] : it.prints,
          }
        : it));

  const setPrint = (i, pi, patch) =>
    setItems((arr) => arr.map((it, idx) =>
      idx === i
        ? { ...it, prints: it.prints.map((p, j) => (j === pi ? { ...p, ...patch } : p)) }
        : it));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const { errors } = validateOrderForm(form, items);
    if (Object.keys(errors).length > 0) {
      // раскрыть секции с ошибками и проскроллить к первому ошибочному полю
      const inMain = Boolean(errors.title || errors.launch_date || errors.due_date);
      const inItems = Object.keys(errors).some((k) => k.startsWith('item_'));
      setOpen((o) => ({
        ...o,
        main: o.main || inMain,
        items: o.items || inItems,
      }));
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-invalid="true"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof el?.focus === 'function') el.focus({ preventScroll: true });
      });
      return;
    }
    const validItems = items.filter((it) => it.product_type.trim() && effectiveQty(it) > 0);
    setSaving(true);
    const created = await createOrder({
      bitrix_id: form.bitrix_id.trim() || undefined,
      title: form.title.trim(),
      manager: form.manager.trim() || undefined,
      launch_date: form.launch_date || undefined,
      due_date: form.due_date || undefined,
      buffer_days: Math.max(0, Number(form.buffer_days) || 0),
      packaging: form.packaging,
      packaging_note: form.packaging === 'other' ? form.packaging_note.trim() || undefined : undefined,
      stickers: form.stickers,
      stickers_note: form.stickers === 'other' ? form.stickers_note.trim() || undefined : undefined,
      no_chestny_znak: form.no_chestny_znak,
      items: validItems.map((it) => {
        const prints = it.has_branding ? it.prints : [];
        return {
          product_type: it.product_type.trim(),
          variant: it.variant.trim() || undefined,
          // сетка заполнена → количество из сетки, иначе ручной ввод
          qty: effectiveQty(it),
          production_type: it.production_type,
          // маршрут строится по техникам из блоков «Нанесение №N»
          branding_methods: [...new Set(prints.map((p) => p.method))],
          branding_on: it.branding_on,
          size_grid: gridToPayload(it.size_grid),
          prints: prints.map((p) => ({
            method: p.method,
            zone: p.zone.trim() || undefined,
            width_mm: Number(p.width_mm) || null,
            height_mm: Number(p.height_mm) || null,
            offset_note: p.offset_note.trim() || undefined,
            pantone: p.pantone.trim() || undefined,
            comment: p.comment.trim() || undefined,
          })),
        };
      }),
    });
    if (created && previewFile) {
      await uploadOrderPreview(created.id, previewFile);
    }
    setSaving(false);
    if (created) {
      clearOrderDraft();
      toast.success(`Заказ «${created.title}» создан, маршрут построен`);
      onClose();
    }
  };

  const printsCount = items.reduce((s, it) => s + (it.has_branding ? it.prints.length : 0), 0);
  const mainSummary = [
    form.title.trim() || 'без названия',
    form.due_date
      ? `до ${new Date(form.due_date + 'T00:00:00').toLocaleDateString('ru-RU')}`
      : null,
  ].filter(Boolean).join(' · ');
  const itemsSummary =
    `${items.length} ${pluralize(items.length, 'позиция', 'позиции', 'позиций')}` +
    ` · ${printsCount} ${pluralize(printsCount, 'нанесение', 'нанесения', 'нанесений')}`;
  const extraSummary = [
    `упаковка: ${PACKAGING_LABELS[form.packaging]}`,
    `стикеры: ${STICKERS_LABELS[form.stickers]}`,
    form.no_chestny_znak ? 'без ЧЗ' : null,
    previewFile ? 'превью ✓' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.modalOverlay} onClick={requestClose} role="presentation">
      <form
        ref={trapRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label="Новый производственный заказ"
      >
        <div className={styles.modalTitle}>Новый заказ</div>

        {draftRestored && (
          <div className={styles.draftBanner} role="status">
            <span>Восстановлен черновик</span>
            <button type="button" className="btn btn-ghost" onClick={resetDraft}>
              Очистить
            </button>
          </div>
        )}

        <FormSection
          id="order-section-main"
          title="Основное"
          summary={mainSummary}
          open={open.main}
          onToggle={() => toggleSection('main')}
        >
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
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Название *</span>
            <input
              className={inputCls('title')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="BOX39 свитшоты"
              required
              maxLength={140}
              aria-invalid={err('title') ? true : undefined}
              aria-describedby={err('title') ? 'err-order-title' : undefined}
              data-invalid={err('title') ? true : undefined}
            />
            <FieldError id="err-order-title" text={err('title')} />
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
              min={initialLaunch}
              className={inputCls('launch_date')}
              value={form.launch_date}
              onChange={(e) => setForm({ ...form, launch_date: e.target.value })}
              aria-invalid={err('launch_date') ? true : undefined}
              aria-describedby={err('launch_date') ? 'err-order-launch' : undefined}
              data-invalid={err('launch_date') ? true : undefined}
            />
            <FieldError id="err-order-launch" text={err('launch_date')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок клиента</span>
            <input
              type="date"
              min={initialLaunch}
              className={inputCls('due_date')}
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              aria-invalid={err('due_date') ? true : undefined}
              aria-describedby={err('due_date') ? 'err-order-due' : undefined}
              data-invalid={err('due_date') ? true : undefined}
            />
            <FieldError id="err-order-due" text={err('due_date')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Буфер, дн.</span>
            <input
              type="number"
              min="0"
              className={styles.input}
              value={form.buffer_days}
              onChange={(e) => setForm({ ...form, buffer_days: e.target.value.replace('-', '') })}
            />
            <span className={styles.subText}>Запас до срока клиента</span>
          </label>
        </div>
        </FormSection>

        <FormSection
          id="order-section-items"
          title="Позиции и ТЗ"
          summary={itemsSummary}
          open={open.items}
          onToggle={() => toggleSection('items')}
        >
        {items.map((it, i) => {
          const gTotal = gridTotal(it.size_grid);
          return (
          <div key={i} className={styles.itemBlock}>
          <div className={styles.itemRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Изделие *</span>
              <input
                className={inputCls(`item_${i}_product_type`)}
                value={it.product_type}
                onChange={(e) => setItem(i, { product_type: e.target.value })}
                placeholder="футболка"
                aria-required="true"
                aria-invalid={err(`item_${i}_product_type`) ? true : undefined}
                aria-describedby={err(`item_${i}_product_type`) ? `err-item-${i}-product` : undefined}
                data-invalid={err(`item_${i}_product_type`) ? true : undefined}
              />
              <FieldError id={`err-item-${i}-product`} text={err(`item_${i}_product_type`)} />
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
            {gTotal > 0 ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Кол-во</span>
                <input
                  className={styles.input}
                  value={gTotal}
                  readOnly
                  aria-label={`Количество позиции ${i + 1} — из размерной сетки`}
                />
                <span className={styles.subText}>из размерной сетки</span>
              </label>
            ) : (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Кол-во *</span>
                <input
                  type="number"
                  min="1"
                  className={inputCls(`item_${i}_qty`)}
                  value={it.qty}
                  onChange={(e) => setItem(i, { qty: e.target.value })}
                  aria-required="true"
                  aria-invalid={err(`item_${i}_qty`) ? true : undefined}
                  aria-describedby={err(`item_${i}_qty`) ? `err-item-${i}-qty` : undefined}
                  data-invalid={err(`item_${i}_qty`) ? true : undefined}
                />
                <FieldError id={`err-item-${i}-qty`} text={err(`item_${i}_qty`)} />
              </label>
            )}
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
              <span className={styles.fieldLabel}>Брендирование</span>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(it.has_branding)}
                  onChange={(e) => setBranding(i, e.target.checked)}
                />
                С нанесением
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Нанесение на</span>
              <select
                className={styles.select}
                value={it.branding_on}
                disabled={!it.has_branding}
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

          {it.has_branding && it.prints.map((p, pi) => (
            <div key={pi} className={styles.printBlock}>
              <div className={`${styles.checkRow} ${styles.printRow}`}>
                <strong className={styles.fieldLabel}>Нанесение №{pi + 1}</strong>
                <select
                  className={`${styles.select} ${styles.inputSm}`}
                  value={p.method}
                  aria-label="Техника нанесения"
                  onChange={(e) => setPrint(i, pi, { method: e.target.value })}
                >
                  {Object.entries(BRANDING_METHOD_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <input
                  className={`${styles.input} ${styles.inputSm} ${styles.printZoneInput}`}
                  placeholder="Расположение (спина справа по втачке)"
                  value={p.zone}
                  onChange={(e) => setPrint(i, pi, { zone: e.target.value })}
                />
                <label className={`${styles.checkLabel} ${styles.mmLabel}`} style={{ gap: 3 }}>
                  <span className={styles.subText}>В, мм</span>
                  <input type="number" min="1"
                    className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                    value={p.height_mm}
                    onChange={(e) => setPrint(i, pi, { height_mm: e.target.value })} />
                </label>
                <label className={`${styles.checkLabel} ${styles.mmLabel}`} style={{ gap: 3 }}>
                  <span className={styles.subText}>Ш, мм</span>
                  <input type="number" min="1"
                    className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                    value={p.width_mm}
                    onChange={(e) => setPrint(i, pi, { width_mm: e.target.value })} />
                </label>
                <button type="button" className="btn btn-ghost" aria-label="Убрать нанесение"
                  onClick={() => setItem(i, { prints: it.prints.filter((_, j) => j !== pi) })}>
                  ✕
                </button>
              </div>
              <div className={`${styles.checkRow} ${styles.printRow}`}>
                <input
                  className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
                  placeholder="Отступ (10см от шва горловины)"
                  value={p.offset_note}
                  onChange={(e) => setPrint(i, pi, { offset_note: e.target.value })}
                />
                <input
                  className={`${styles.input} ${styles.inputSm} ${styles.pantoneInput}`}
                  placeholder="Pantone (1163, 1181)"
                  value={p.pantone}
                  onChange={(e) => setPrint(i, pi, { pantone: e.target.value })}
                />
                <input
                  className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
                  placeholder="Комментарий (макет как в сделке…)"
                  value={p.comment}
                  onChange={(e) => setPrint(i, pi, { comment: e.target.value })}
                />
              </div>
            </div>
          ))}

          {it.has_branding && (
            <div
              className={styles.checkRow}
              data-invalid={err(`item_${i}_prints`) ? true : undefined}
            >
              <button
                type="button"
                className="btn btn-secondary"
                aria-describedby={err(`item_${i}_prints`) ? `err-item-${i}-prints` : undefined}
                onClick={() => setItem(i, { prints: [...it.prints, { ...EMPTY_PRINT }] })}
              >
                + Нанесение ({it.prints.length})
              </button>
              <FieldError id={`err-item-${i}-prints`} text={err(`item_${i}_prints`)} />
            </div>
          )}

          <details className={styles.gridDetails}>
            <summary className={styles.subText}>
              Размерная сетка (цвет × размер){gTotal > 0 ? ` — ${gTotal} шт` : ''}
            </summary>
            <SizeGridEditor
              grid={it.size_grid}
              onChange={(g) => setItem(i, { size_grid: g })}
            />
          </details>
          </div>
          );
        })}
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setItems((arr) => [...arr, { ...EMPTY_ITEM }])}
          >
            + Добавить позицию
          </button>
        </div>
        </FormSection>

        <FormSection
          id="order-section-extra"
          title="Упаковка и доп."
          summary={extraSummary}
          open={open.extra}
          onToggle={() => toggleSection('extra')}
        >
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

        </FormSection>

        <div className={styles.modalActions}>
          {submitted && validation.missing.length > 0 && (
            <span className={styles.remainingHint} role="status">
              Осталось заполнить: {validation.missing.join(', ')}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={requestClose}>Отмена</button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || (submitted && validation.missing.length > 0)}
          >
            {saving ? 'Создание…' : 'Создать заказ'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function OrdersScreen({ user }) {
  const {
    orders, departments, loading, loaded, loadAll, deleteOrder, shipOrder,
    archiveLoaded, archiveLoading, loadArchive,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      deleteOrder: s.deleteOrder,
      shipOrder: s.shipOrder,
      archiveLoaded: s.archiveLoaded,
      archiveLoading: s.archiveLoading,
      loadArchive: s.loadArchive,
    })),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tab, setTab] = useState('active'); // active | archive
  const isMobile = useMediaQuery('(max-width: 760px)');
  // Фильтры сроков/готовности — в URL (?filter=ready|urgent|overdue),
  // чтобы работали ссылки с KPI-плиток дашборда
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const filter = ['ready', 'urgent', 'overdue'].includes(filterParam) ? filterParam : null;
  const toggleFilter = (name) =>
    setSearchParams(filter === name ? {} : { filter: name }, { replace: true });
  // Счётчики чипов — та же логика, что у KPI-плиток дашборда (активные заказы)
  const counts = useMemo(() => {
    const active = orders.filter((o) => o.status === 'active');
    return {
      ready: active.filter((o) => isOrderReadyToShip(o)).length,
      urgent: active.filter((o) => isUrgent(o.due_date)).length,
      overdue: active.filter((o) => isOverdue(o.due_date)).length,
    };
  }, [orders]);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  // Архив лениво: грузится при первом заходе на вкладку
  useEffect(() => {
    if (tab === 'archive' && !archiveLoaded && !archiveLoading) loadArchive();
  }, [tab, archiveLoaded, archiveLoading, loadArchive]);

  const canDelete = ['admin', 'director'].includes(user?.role);

  const inTab = useMemo(
    () => orders.filter((o) => {
      if (tab === 'archive') return o.status !== 'active';
      if (o.status !== 'active') return false;
      if (filter === 'ready') return isOrderReadyToShip(o);
      if (filter === 'urgent') return isUrgent(o.due_date);
      if (filter === 'overdue') return isOverdue(o.due_date);
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
        <div role="tablist" aria-label="Фильтр заказов" className={styles.filterRow}>
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
            Архив{archiveLoaded ? ` (${orders.filter((o) => o.status !== 'active').length})` : ''}
          </button>
          {tab === 'active' && (
            <>
              <button
                type="button"
                aria-pressed={filter === 'ready'}
                className={`${styles.chip} ${filter === 'ready' ? styles.chipReady : styles.chipNeutral}`}
                style={{ cursor: 'pointer', font: 'inherit' }}
                onClick={() => toggleFilter('ready')}
              >
                ✅ Готовы к отгрузке ({counts.ready})
              </button>
              <button
                type="button"
                aria-pressed={filter === 'urgent'}
                className={`${styles.chip} ${filter === 'urgent' ? styles.chipProgress : styles.chipNeutral}`}
                style={{ cursor: 'pointer', font: 'inherit' }}
                onClick={() => toggleFilter('urgent')}
              >
                🔥 Срок ≤ 3 дней ({counts.urgent})
              </button>
              <button
                type="button"
                aria-pressed={filter === 'overdue'}
                className={`${styles.chip} ${filter === 'overdue' ? styles.chipBlocked : styles.chipNeutral}`}
                style={{ cursor: 'pointer', font: 'inherit' }}
                onClick={() => toggleFilter('overdue')}
              >
                ⏰ Просрочено ({counts.overdue})
              </button>
            </>
          )}
        </div>
        <input
          type="search"
          className={`${styles.input} ${styles.searchInput}`}
          placeholder="Поиск: название, № сделки, менеджер"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск заказов"
        />
        <label className={styles.checkLabel}>
          Создан с
          <input
            type="date"
            className={styles.input}
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Дата создания: с"
          />
        </label>
        <label className={styles.checkLabel}>
          по
          <input
            type="date"
            className={styles.input}
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Дата создания: по"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setDateFrom(''); setDateTo(''); }}
          >
            Сбросить даты
          </button>
        )}
        <div className={styles.spacer} />
        <span className={styles.subText}>{filtered.length} из {inTab.length}</span>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Новый заказ
        </button>
      </div>

      {loading && !loaded && <TableSkeleton rows={6} label="Загрузка заказов" />}
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

      {filtered.length > 0 && isMobile && (
        <div className={styles.orderCardList}>
          {filtered.map((o) => (
            <OrderCardMobile
              key={o.id}
              order={o}
              departments={departments}
              onDelete={onDelete}
              canDelete={canDelete}
              onShip={onShip}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && !isMobile && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№ сделки</th>
                <th>Заказ</th>
                <th>Менеджер</th>
                <th>Кол-во</th>
                <th>Создан</th>
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
                  onShip={onShip}
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
