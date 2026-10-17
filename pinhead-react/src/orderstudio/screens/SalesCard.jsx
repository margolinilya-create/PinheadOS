import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSalesStore } from '../store/useSalesStore';
import { confirm } from '../../store/useConfirmStore';
import { newSalesItem } from '../model/factory';
import ItemEditor from './ItemEditor';
import PricePanel from './PricePanel';
import { useOrderPrice } from './useOrderPrice';
import { PACKAGING_OPTIONS, STATUS_LABELS } from './labels';
import BufferedInput from './BufferedInput';
import { formatMoney, parseMoney } from './fieldParse';
import styles from './Sales.module.css';
import { orderUrgentDays } from '../pricing/priceOrder';
import { URGENT_DAY_OPTIONS, URGENT_BY_DAYS } from '../../utils/costRules';

const SAVE_LABELS = {
  clean: 'сохранено',
  dirty: 'есть правки…',
  saving: 'сохраняю…',
  error: 'не сохранено — повторим при следующей правке',
  locked: 'только чтение — заказ отправлен в работу',
  outdated: 'не сохранено — вышло обновление, обновите страницу',
  conflict: 'не сохранено — заказ изменён в другой вкладке, обновите страницу',
};
/** Состояния, о которых нужно сказать цветом ошибки */
const SAVE_ALERT = new Set(['error', 'outdated', 'conflict']);

/** Карточка заказа v4 (срез 1): шапка, позиции, живая цена, автосохранение */
export default function SalesCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { order, loading, saveState, open, flush, edit } = useSalesStore(useShallow((s) => ({
    order: s.current,
    loading: s.currentLoading,
    saveState: s.saveState,
    open: s.open,
    flush: s.flush,
    edit: s.edit,
  })));
  const price = useOrderPrice(order);

  useEffect(() => {
    if (id) open(id);
  }, [id, open]);
  // Уход с карточки сохраняет несохранённое, не дожидаясь паузы. Карточку
  // не закрывает: визард позиции и возврат из него работают с тем же заказом
  // без перечитывания, а другой заказ закрывает прежний сам (`open`)
  useEffect(() => () => { flush(); }, [flush]);

  if (loading || (!order && id)) {
    return <div className={styles.page}><div className={styles.empty}>{loading ? 'Загрузка…' : 'Заказ не найден'}</div></div>;
  }
  if (!order) return null;

  const set = (patch) => edit((o) => ({ ...o, ...patch }));
  const setItem = (i, patch) => edit((o) => ({
    ...o,
    items: o.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
  }));
  const addItem = () => edit((o) => ({ ...o, items: [...o.items, newSalesItem()] }));
  // Удаление уходит в базу автосохранением, отмены нет — поэтому спрашиваем
  const removeItem = async (i) => {
    const it = order.items[i];
    const ok = await confirm({
      title: `Удалить позицию ${i + 1}?`,
      message: it?.product_type ? `«${it.product_type}» со всеми нанесениями и бирками.` : 'Позиция удалится со всеми нанесениями и бирками.',
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (ok) edit((o) => ({ ...o, items: o.items.filter((_, j) => j !== i) }));
  };

  // Вид скидки хранится и при нулевой сумме: прежде `null` на пустом поле
  // сбрасывал «₽» обратно на «%», и набранные 1000 ₽ превращались в 1000 %
  const discount = order.discount ?? { mode: 'pct', value: 0 };
  const setDiscount = (patch) => {
    const next = { ...discount, ...patch };
    const cap = next.mode === 'pct' ? 100 : Infinity;
    set({ discount: { mode: next.mode, value: Math.min(cap, Math.max(0, next.value || 0)) } });
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <button type="button" className={styles.back} onClick={() => navigate('/sales')}>← Все заказы v4</button>
          <h1 className={styles.title}>{order.number || 'Новый заказ'}{order.title ? ` · ${order.title}` : ''}</h1>
          <div className={styles.row}>
            <span className={styles.badge}>{STATUS_LABELS[order.status]}</span>
            <span className={`${styles.saveState}${SAVE_ALERT.has(saveState) ? ` ${styles.saveError}` : ''}`} role="status" aria-live="polite">
              {SAVE_LABELS[saveState]}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        <div>
          <section className={styles.panel} aria-label="Шапка заказа">
            <div className={styles.panelTitle}>Заказ</div>
            <div className={styles.grid2}>
              <label className={styles.field}>Название
                <input autoFocus className={styles.input} value={order.title} onChange={(e) => set({ title: e.target.value })} placeholder="Клиент · изделие" />
              </label>
              <label className={styles.field}>Клиент
                <input className={styles.input} value={order.customer} onChange={(e) => set({ customer: e.target.value })} />
              </label>
              <label className={styles.field}>Контакт
                <input className={styles.input} value={order.contact} onChange={(e) => set({ contact: e.target.value })} placeholder="Имя, телефон" />
              </label>
              <label className={styles.field}>Менеджер
                <input className={styles.input} value={order.manager} onChange={(e) => set({ manager: e.target.value })} />
              </label>
              <label className={styles.field}>Сделка Bitrix
                <input className={styles.input} value={order.bitrix_id} onChange={(e) => set({ bitrix_id: e.target.value })} placeholder="[12345]" />
              </label>
              <label className={styles.field}>Срок (дата в КП)
                <input className={styles.input} type="date" value={order.due_date} onChange={(e) => set({ due_date: e.target.value })} />
              </label>
              <label className={styles.field}>Срочный пошив
                <select className={styles.select} value={orderUrgentDays(order)}
                  onChange={(e) => { const d = Number(e.target.value); set({ urgent_days: d, urgent: d > 0 }); }}>
                  {URGENT_DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>{d === 0 ? 'Обычный срок' : `На ${d} дней раньше (+${Math.round(URGENT_BY_DAYS[d] * 100)} % к изделию)`}</option>
                  ))}
                </select>
              </label>
              <div className={styles.field}>Скидка на заказ
                <div className={styles.row}>
                  <BufferedInput
                    className={styles.input}
                    aria-label="Размер скидки"
                    inputMode="decimal"
                    value={discount.value || null}
                    format={formatMoney}
                    parse={parseMoney}
                    onCommit={(v) => setDiscount({ value: v ?? 0 })}
                  />
                  <select className={styles.select} aria-label="Вид скидки" value={discount.mode} onChange={(e) => setDiscount({ mode: e.target.value })}>
                    <option value="pct">%</option>
                    <option value="sum">₽</option>
                  </select>
                </div>
              </div>
            </div>

            <details className={styles.details}>
              <summary>Доставка и упаковка заказа</summary>
              <div className={styles.grid2}>
                <label className={styles.field}>Доставка
                  <select className={styles.select} value={order.delivery_method} onChange={(e) => set({ delivery_method: e.target.value })}>
                    <option value="">—</option>
                    <option value="pickup">Самовывоз</option>
                    <option value="courier">Курьер</option>
                    <option value="carrier">Транспортная компания</option>
                  </select>
                </label>
                <label className={styles.field}>Адрес
                  <input className={styles.input} value={order.delivery_address} onChange={(e) => set({ delivery_address: e.target.value })} />
                </label>
                <label className={styles.field}>Упаковка
                  <select className={styles.select} value={order.packaging} onChange={(e) => set({ packaging: e.target.value })}>
                    {PACKAGING_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </label>
                <label className={styles.field}>Требования к упаковке
                  <input className={styles.input} value={order.packaging_note} onChange={(e) => set({ packaging_note: e.target.value })} />
                </label>
                <label className={styles.check}>
                  <input type="checkbox" checked={order.no_chestny_znak} onChange={(e) => set({ no_chestny_znak: e.target.checked })} />
                  Без «Честного знака»
                </label>
              </div>
            </details>
          </section>

          {order.items.map((it, i) => (
            <ItemEditor
              key={it.key}
              item={it}
              index={i}
              price={price?.items.find((p) => p.key === it.key) ?? null}
              onChange={(patch) => setItem(i, patch)}
              onRemove={() => removeItem(i)}
            />
          ))}
          <div className={styles.row}>
            <button type="button" className="btn" onClick={addItem}>+ Позиция вручную</button>
          </div>
        </div>

        <PricePanel order={order} price={price} />
      </div>
    </div>
  );
}
