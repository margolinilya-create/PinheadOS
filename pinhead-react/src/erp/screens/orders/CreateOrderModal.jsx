import { useEffect, useMemo, useRef, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { isQueueDept, deptShortName } from '../../data/departments';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { formatDateShort } from '../../utils/time';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { pluralize } from '../../../utils/i18n';
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
} from '../../utils/orderForm';
import {
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
  SUBCONTRACT_OP_TYPE_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
} from '../../types';
import styles from '../../erp.module.css';

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

export function CreateOrderModal({ onClose }) {
  const createOrder = useErpStore((s) => s.createOrder);
  const uploadOrderPreview = useErpStore((s) => s.uploadOrderPreview);
  const departments = useErpStore((s) => s.departments);
  const queueDepts = useMemo(
    () => departments.filter((d) => d.active && isQueueDept(d.code)),
    [departments],
  );
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
    // Правка 4.2.3: если для отдельной операции нужна доработка — участок обязателен
    const missingNextDept = validItems.some(
      (it) => it.production_type === 'outsource'
        && (it.subcontract_kind || 'finished_product') === 'operation'
        && it.needs_further && !it.return_dept);
    if (missingNextDept) {
      toast.error('Выберите следующий участок для доработки после операции подряда');
      return;
    }
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
          // Подряд (волна 4.2): тип и источник материалов только для типа «Подряд»
          ...(it.production_type === 'outsource'
            ? { subcontract_kind: it.subcontract_kind || 'finished_product',
                material_source: it.material_source || 'pinhead',
                // Операция (правка 4.2.3) — только для отдельной операции
                subcontract_operation: (it.subcontract_kind || 'finished_product') === 'operation'
                  ? (it.subcontract_operation?.trim() || undefined) : undefined,
                // Следующий участок — только если для отдельной операции нужна доработка
                return_dept: (it.subcontract_kind || 'finished_product') === 'operation' && it.needs_further
                  ? (it.return_dept || null) : null }
            : {}),
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
      ? `до ${formatDateShort(form.due_date)}`
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
            {it.production_type === 'outsource' && (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Тип подряда</span>
                  <select
                    className={styles.select}
                    value={it.subcontract_kind ?? 'finished_product'}
                    onChange={(e) => setItem(i, { subcontract_kind: e.target.value })}
                    aria-label="Тип подряда"
                  >
                    {Object.entries(SUBCONTRACT_OP_TYPE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Материалы</span>
                  <select
                    className={styles.select}
                    value={it.material_source ?? 'pinhead'}
                    onChange={(e) => setItem(i, { material_source: e.target.value })}
                    aria-label="Источник материалов"
                  >
                    {Object.entries(SUBCONTRACT_MATERIAL_SOURCE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </label>
                {(it.subcontract_kind ?? 'finished_product') === 'operation' && (
                  <>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Операция подрядчика</span>
                      <input
                        className={styles.input}
                        value={it.subcontract_operation ?? ''}
                        onChange={(e) => setItem(i, { subcontract_operation: e.target.value })}
                        placeholder="печать по полотну / варка / вышивка…"
                        aria-label="Какая операция выполняется подрядчиком"
                      />
                    </label>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Требуется доработка в Pinhead?</span>
                      <div className={styles.tileRow} role="radiogroup" aria-label="Требуется доработка в Pinhead">
                        {[['no', 'Нет'], ['yes', 'Да']].map(([v, label]) => {
                          const on = (v === 'yes') === Boolean(it.needs_further);
                          return (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              className={`${styles.tile} ${on ? styles.tileActive : ''}`}
                              onClick={() => setItem(i, {
                                needs_further: v === 'yes',
                                return_dept: v === 'yes' ? it.return_dept : '',
                              })}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {it.needs_further && (
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Следующий участок</span>
                        <select
                          className={styles.select}
                          value={it.return_dept ?? ''}
                          onChange={(e) => setItem(i, { return_dept: e.target.value })}
                          aria-label="Следующий участок после операции подряда"
                        >
                          <option value="">Выберите участок…</option>
                          {queueDepts.map((d) => (
                            <option key={d.code} value={d.code}>{deptShortName(d.code, d.name)}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </>
            )}
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
