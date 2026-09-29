import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSalesStore } from '../store/useSalesStore';
import { newSalesItem } from '../model/factory';
import ItemEditor from './ItemEditor';
import PricePanel from './PricePanel';
import { useOrderPrice } from './useOrderPrice';
import { STATUS_LABELS } from './labels';
import styles from './Sales.module.css';

const SAVE_LABELS = {
  idle: '',
  dirty: 'есть правки…',
  saving: 'сохраняю…',
  saved: 'сохранено',
  error: 'не сохранено — повторим при следующей правке',
};

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
  const removeItem = (i) => edit((o) => ({ ...o, items: o.items.filter((_, j) => j !== i) }));

  const discount = order.discount ?? { mode: 'pct', value: 0 };
  const setDiscount = (patch) => {
    const next = { ...discount, ...patch };
    set({ discount: next.value > 0 ? next : null });
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <button type="button" className={styles.back} onClick={() => navigate('/sales')}>← Все заказы v4</button>
          <h1 className={styles.title}>{order.number || 'Новый заказ'}{order.title ? ` · ${order.title}` : ''}</h1>
          <div className={styles.row}>
            <span className={styles.badge}>{STATUS_LABELS[order.status]}</span>
            <span className={`${styles.saveState}${saveState === 'error' ? ` ${styles.saveError}` : ''}`} role="status" aria-live="polite">
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
              <label className={styles.check}>
                <input type="checkbox" checked={order.urgent} onChange={(e) => set({ urgent: e.target.checked })} />
                Срочный заказ
              </label>
              <div className={styles.field}>Скидка на заказ
                <div className={styles.row}>
                  <input
                    className={styles.input}
                    aria-label="Размер скидки"
                    type="number"
                    min="0"
                    value={discount.value || ''}
                    onChange={(e) => setDiscount({ value: Math.max(0, Number(e.target.value) || 0) })}
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
                    <option value="none">Без упаковки</option>
                    <option value="individual">Индивидуальная</option>
                    <option value="bulk">Навалом</option>
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
              onWizard={() => navigate(`/sales/${order.id}/item/${it.key}`)}
            />
          ))}
          <div className={styles.row}>
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/sales/${order.id}/item/new`)}>+ Позиция в визарде</button>
            <button type="button" className="btn" onClick={addItem}>+ Позиция вручную</button>
          </div>
        </div>

        <PricePanel order={order} price={price} />
      </div>
    </div>
  );
}
