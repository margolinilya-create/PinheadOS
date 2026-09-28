import { useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { DictionaryDatalist } from '../../components/DictionaryDatalist';
import { PurchaseSizeTable } from './PurchaseSizeTable';
import { FieldError } from '../orders/create/FormParts';
import { garmentPurchaseCandidates, garmentPurchaseDraft } from '../../utils/garmentPurchase';
import { useDictionary } from '../../store/useDictionary';
import { scrollIntoViewSafely } from '../../utils/scrollIntoViewSafely';
import {
  KIND_LABELS, PURCHASE_FIELD_LABELS, SOURCE_LABELS,
  pricePerUnitLabel, priceRequiredFor, validatePurchaseForm,
} from './purchaseLabels';
import styles from '../../styles';

/**
 * Модалка «Новая закупка».
 *
 * Вынесена из `FabricPurchasing.jsx` 27.09 (правка 1): экран стоял на потолке
 * ратчета размера, а модалка — самостоятельная форма со своей валидацией.
 *
 * `orderId` предвыбирает заказ: из очереди закупки материал заводят конкретному
 * заказу, и заставлять искать его в списке из полусотни — лишний шаг ровно там,
 * где человек уже сказал, о каком заказе речь.
 *
 * Селект заказа остаётся: он показывает, КУДА уедет строка, — а с 04.09
 * единственный вход в модалку идёт из карточки, то есть приходит заполненным.
 *
 * ОБЯЗАТЕЛЬНЫЕ ПОЛЯ ПОДСВЕЧИВАЮТСЯ (правка 27.09, п. 1): «при нажатии
 * „Добавить" подсвечивать красной обводкой все незаполненные обязательные
 * поля». До правки `submit` останавливался тостом на первой ошибке —
 * человек чинил одно поле и получал следующий тост. Теперь ошибки считает
 * `validatePurchaseForm` по всем полям сразу, а форма ставит рамку,
 * `aria-invalid`, текст под полем и уводит фокус на первое ошибочное —
 * тем же приёмом, что форма создания заказа. Тоста нет: он не показывает, ГДЕ.
 */

const EMPTY_MAT = {
  order_id: '', kind: 'fabric', name: '', source: 'purchase', supplier: '',
  color: '', article: '', qty: '', unit: '', price_per_unit: '', eta_date: '',
  // Параметры полотна для учёта в метрах (правка 27.09, п. 4): ширина, см
  // и плотность, г/м² — подставляются в рулоны при приёмке
  width_cm: '', density_gsm: '',
  // Потребность производства (правка 14.09, п. 2) и факт закупщика
  // (документ 20.08, п. 4): сколько нужно, сколько заказал и когда
  qty_expected: '', qty_ordered: '', ordered_on: '',
  // Закупка ГОТОВОГО ИЗДЕЛИЯ (правка 16.09, п. 2): позиция заказа и её
  // размерная разбивка. Пусто — обычная закупка материала
  item_id: '', size_grid: null,
  // Фактически заказано по размерам (правка 20.09, п. 2) — отдельно
  // от потребности: по ней считается qty_expected
  size_grid_ordered: null,
};

export function AddPurchaseModal({ orders, orderId = '', onAdd, onClose }) {
  const [form, setForm] = useState({ ...EMPTY_MAT, order_id: orderId });
  const [saving, setSaving] = useState(false);
  /** Нажимал ли «Добавить»: до этого подсветки нет — пустая форма не «ошибка» */
  const [submitted, setSubmitted] = useState(false);
  const bodyRef = useRef(null);
  /**
   * Тронул ли человек «Фактическое количество» (правка 14.09, п. 2). Пока нет,
   * оно едет за потребностью подстановкой; после первой правки — своё.
   * Признак в состоянии, а не сравнение значений: равные числа означали бы
   * «не трогал», и введённый вручную тот же самый факт снова стал бы зеркалом.
   */
  const [factTouched, setFactTouched] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Подпись и обязательность цены — по виду и единице материала (п. 1).
   * Справочник единиц тот же, что у приёмки: в `unit` на бою лежат и код
   * («кг»), и имя («Килограммы») одного значения.
   */
  const units = useDictionary('unit');
  const priceLabel = pricePerUnitLabel(form.unit, units);
  const priceRequired = priceRequiredFor(form.kind);
  const qtyRequired = form.source === 'purchase';

  const errors = useMemo(
    () => (submitted ? validatePurchaseForm(form, { priceRequired, priceLabel }) : {}),
    [submitted, form, priceRequired, priceLabel],
  );
  const err = (key) => errors[key];
  const cls = (base, key) => (err(key) ? `${base} ${styles.inputError}` : base);
  const invalidProps = (key, errId) => ({
    'aria-invalid': err(key) ? true : undefined,
    'aria-describedby': err(key) ? errId : undefined,
    'data-invalid': err(key) ? true : undefined,
  });

  /**
   * Позиции выбранного заказа, которые закупаются как ГОТОВОЕ ИЗДЕЛИЕ.
   * Правило одно на всю систему — `garmentPurchaseCandidates`: оно же решает,
   * есть ли у позиции этап «Закупка» в маршруте.
   */
  const garmentItems = useMemo(() => {
    const order = orders.find((o) => o.id === form.order_id);
    return garmentPurchaseCandidates(order?.items);
  }, [orders, form.order_id]);

  /**
   * Подстановка из позиции. Сброс на пустой выбор возвращает обычную закупку
   * материала — иначе в форме остались бы поля изделия без самого изделия.
   */
  const pickGarment = (itemId) => {
    if (!itemId) {
      set({ item_id: '', size_grid: null, size_grid_ordered: null, kind: 'fabric' });
      return;
    }
    const draft = garmentPurchaseDraft(garmentItems.find((i) => i.id === itemId));
    if (!draft) return;
    set({
      item_id: draft.item_id,
      kind: draft.kind,
      name: draft.name,
      color: draft.color ?? '',
      unit: draft.unit,
      size_grid: draft.size_grid,
      qty_expected: String(draft.qty_expected),
      // Факт закупщика едет за потребностью, пока он его не тронул —
      // то же правило, что у ручного ввода количества
      ...(factTouched ? {} : { qty_ordered: String(draft.qty_expected) }),
    });
  };

  const submit = async () => {
    setSubmitted(true);
    /**
     * План прихода БОЛЬШЕ НЕ ОБЯЗАТЕЛЕН (правка заказчика 16.08, п. 13):
     * «менеджер зачастую не знает эту информацию на момент запуска, поле должен
     * заполнять закупщик после взаимодействия с поставщиком». Строку заводят
     * ДО разговора с поставщиком — и раньше её нельзя было завести вовсе,
     * не выдумав дату.
     *
     * Количество обязательным остаётся: без него закупка не закроется
     * автоматически (`supply.missingPlan`), то есть строка просто застрянет.
     *
     * ЦЕНА ТКАНИ ОБЯЗАТЕЛЬНА (правка 21.09, п. 1). Гейт стоит на ЗАВЕДЕНИИ
     * строки, и ровно такой же — в триггере на INSERT: страж разрешает то же,
     * что разрешает интерфейс. На правку уже заведённых строк он не
     * распространяется — десять тканей из семнадцати на бою без цены,
     * и требование при каждой правке заперло бы их целиком.
     */
    const found = validatePurchaseForm(form, { priceRequired, priceLabel });
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => {
        const el = bodyRef.current?.querySelector('[data-invalid="true"]');
        scrollIntoViewSafely(el, { block: 'center' });
        if (typeof el?.focus === 'function') el.focus({ preventScroll: true });
      });
      return;
    }
    setSaving(true);
    /**
     * ДВА КОЛИЧЕСТВА (правка заказчика 14.09, п. 2): потребность производства
     * и факт заказа у поставщика. До 14.09 поле было одно (правка 30.08, п. 8)
     * и заполняло обе колонки — документ просит их разделить, потому что
     * «плановую потребность и фактически заказанное легко перепутать».
     *
     * ОБЯЗАТЕЛЬНА ПОТРЕБНОСТЬ: `qty_expected` — знаменатель приёмки на складе
     * и условие автозакрытия закупки (`supply.missingPlan`). Строка без неё
     * не закроется автоматически НИКОГДА. Факт может быть пустым: счёт
     * поставщика приходит позже, чем заводится строка.
     */
    const qtyExpected = Number(form.qty_expected);
    const row = await onAdd(form.order_id, {
      kind: form.kind, name: form.name.trim(), source: form.source,
      supplier: form.supplier.trim() || null, color: form.color.trim() || null,
      article: form.article.trim() || null, qty: form.qty.trim() || null,
      qty_expected: form.qty_expected === '' ? null : qtyExpected,
      unit: form.unit.trim() || null,
      price_per_unit: form.price_per_unit === '' ? null : Number(form.price_per_unit),
      eta_date: form.eta_date || null,
      width_cm: form.kind === 'fabric' && form.width_cm !== '' ? Number(form.width_cm) : null,
      density_gsm: form.kind === 'fabric' && form.density_gsm !== '' ? Number(form.density_gsm) : null,
      qty_ordered: form.qty_ordered === '' ? null : Number(form.qty_ordered),
      ordered_on: form.ordered_on || null,
      /**
       * Закупка готового изделия принадлежит ПОЗИЦИИ и несёт её разбивку
       * (правка 16.09, п. 2). При непустой сетке `qty_expected` пересчитает
       * триггер — сумма по размерам и «общая потребность» это одно число.
       */
      item_id: form.item_id || null,
      size_grid: form.size_grid,
      size_grid_ordered: form.size_grid_ordered,
      status: form.source === 'purchase' || form.source === 'stock' ? 'pending' : 'received',
    });
    setSaving(false);
    if (row) onClose();
  };

  return (
    <Modal title="Новая закупка" onClose={onClose}>
        <div className={styles.formGrid} ref={bodyRef}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Заказ *</span>
            <select
              className={cls(styles.select, 'order_id')}
              value={form.order_id}
              onChange={(e) => set({ order_id: e.target.value })}
              aria-label="Заказ"
              {...invalidProps('order_id', 'err-purchase-order')}
            >
              <option value="">Выберите заказ…</option>
              {orders.map((o) => <option key={o.id} value={o.id}>№{o.bitrix_id || '—'} · {o.title}</option>)}
            </select>
            <FieldError id="err-purchase-order" text={err('order_id')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип</span>
            <select className={styles.select} value={form.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Тип материала">
              {Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {/*
            ЗАКУПКА ГОТОВОГО ИЗДЕЛИЯ СОБИРАЕТСЯ ИЗ ПОЗИЦИИ (правка 16.09, п. 2).

            Документ: «закупка должна формироваться на основании самой позиции
            заказа, а не по логике закупки материалов… одна закупка на 100
            футболок с разбивкой внутри, а не отдельная закупка на каждый
            размер». Поэтому здесь не новая форма, а ПОДСТАНОВКА: выбор позиции
            заполняет наименование, цвет, тираж и размерную разбивку разом.

            Селект появляется, только когда в заказе есть что закупать как
            изделие: у заказа на пошив он был бы пустым выбором, сбивающим
            с толку.
          */}
          {garmentItems.length > 0 && (
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.fieldLabel}>Готовое изделие из позиции заказа</span>
              <select
                className={styles.select}
                value={form.item_id}
                onChange={(e) => pickGarment(e.target.value)}
                aria-label="Готовое изделие из позиции заказа"
              >
                <option value="">Закупка материала (обычная)</option>
                {garmentItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {[it.product_type, it.variant].filter(Boolean).join(' ')}
                    {' — '}
                    {garmentPurchaseDraft(it)?.qty_expected ?? it.qty} шт
                  </option>
                ))}
              </select>
            </label>
          )}
          {/*
            Таблица «Размер / Количество к заказу / Фактическое количество»
            (правка 20.09, п. 2). Прежде здесь стоял `SizeGridView` — только
            чтение: человек видел потребность, но сказать, сколько заказал
            у поставщика по каждому размеру, ему было негде.
          */}
          {form.size_grid && (
            <PurchaseSizeTable
              plannedGrid={form.size_grid}
              orderedGrid={form.size_grid_ordered}
              onChange={(grid) => set({ size_grid_ordered: grid })}
              caption="Размеры закупки: потребность и фактический заказ"
            />
          )}
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Материал *</span>
            <input
              className={cls(styles.input, 'name')}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Кулирка 230гр чёрная"
              aria-label="Материал"
              {...invalidProps('name', 'err-purchase-name')}
            />
            <FieldError id="err-purchase-name" text={err('name')} />
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
          {/*
            ДВА КОЛИЧЕСТВА, И ОНИ РАЗНЫЕ (правка 14.09, п. 2). Документ просит
            разделить «потребность производства» и «сколько реально заказали
            у поставщика»: первое — знаменатель приёмки на складе и условие
            автозакрытия закупки, второе — факт по счёту.

            ПОЧЕМУ ФАКТ ЕДЕТ ЗА ПОТРЕБНОСТЬЮ ПОДСТАНОВКОЙ. Правка 30.08 свела
            эти поля в одно ровно потому, что второе «правилось хорошо если раз
            на сотню строк»: заводя строку, закупщик обычно заказывает ровно
            столько, сколько нужно. Подстановка сохраняет прежнюю скорость
            ввода и не врёт: как только человек тронул поле факта, оно живёт
            своей жизнью (`factTouched`) и потребность его больше не двигает.

            Обязательна ПОТРЕБНОСТЬ, а не факт: без неё строка не закроется
            автоматически никогда (`supply.missingPlan`).

            Статус здесь не спрашивается вовсе: «Заказано» ставится по факту
            и дате заказа (`utils/materialStatus`).
          */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {PURCHASE_FIELD_LABELS.qtyExpected}{qtyRequired ? ' *' : ''}
            </span>
            <input
              type="number" min="0" step="any"
              className={cls(styles.input, 'qty_expected')}
              value={form.qty_expected}
              onChange={(e) => {
                const value = e.target.value.replace('-', '');
                set(factTouched
                  ? { qty_expected: value }
                  : { qty_expected: value, qty_ordered: value });
              }}
              aria-label={PURCHASE_FIELD_LABELS.qtyExpected}
              {...invalidProps('qty_expected', 'err-purchase-qty')}
            />
            <FieldError id="err-purchase-qty" text={err('qty_expected')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{PURCHASE_FIELD_LABELS.qtyOrdered}</span>
            <input
              type="number" min="0" step="any" className={styles.input}
              value={form.qty_ordered}
              onChange={(e) => {
                setFactTouched(true);
                set({ qty_ordered: e.target.value.replace('-', '') });
              }}
              aria-label={PURCHASE_FIELD_LABELS.qtyOrdered}
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
          {/*
            ЦЕНА ПОДПИСАНА ЕДИНИЦЕЙ МАТЕРИАЛА (правка 21.09, п. 1) и обязательна
            у ткани: по ней считается себестоимость полотна и стоимость
            возвратного остатка заказа.
          */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {priceLabel}{priceRequired ? ' *' : ''}
            </span>
            <input
              type="number" min="0" step="0.01"
              className={cls(styles.input, 'price_per_unit')}
              value={form.price_per_unit}
              onChange={(e) => set({ price_per_unit: e.target.value })}
              aria-label={priceLabel}
              {...invalidProps('price_per_unit', 'err-purchase-price')}
            />
            <FieldError id="err-purchase-price" text={err('price_per_unit')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>План прихода</span>
            <DateField value={form.eta_date} onChange={(v) => set({ eta_date: v })} aria-label="План прихода" />
          </label>
          {/*
            ШИРИНА И ПЛОТНОСТЬ ПОЛОТНА (правка 27.09, п. 4): по ним склад
            считает метраж каждого рулона при приёмке. Не обязательны —
            «черновик приёмки разрешить сохранить без параметров», а закрой
            дозаполнит до записи расхода. Только у ткани: у фурнитуры
            плотности нет.
          */}
          {form.kind === 'fabric' && (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Ширина полотна, см</span>
                <input
                  type="number" min="0" step="1" className={styles.input}
                  value={form.width_cm}
                  onChange={(e) => set({ width_cm: e.target.value.replace('-', '') })}
                  aria-label="Ширина полотна, см"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Плотность, г/м²</span>
                <input
                  type="number" min="0" step="1" className={styles.input}
                  value={form.density_gsm}
                  onChange={(e) => set({ density_gsm: e.target.value.replace('-', '') })}
                  aria-label="Плотность, г/м²"
                />
              </label>
            </>
          )}
        </div>
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={saving} onClick={submit}>Добавить</Button>
        </div>
    </Modal>
  );
}
