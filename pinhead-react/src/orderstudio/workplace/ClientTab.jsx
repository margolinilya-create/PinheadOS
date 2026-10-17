import { useEffect, useRef } from 'react';
import { orderUrgentDays } from '../pricing/priceOrder';
import { URGENT_DAY_OPTIONS, URGENT_BY_DAYS } from '../../utils/costRules';
import { PACKAGING_OPTIONS } from '../screens/labels';
import DiscountField from './DiscountField';
import sales from '../screens/Sales.module.css';
import styles from './Workplace.module.css';

/**
 * Вкладка «Клиент и доставка»: шапка заказа, доставка и упаковка заказа,
 * срочность, скидка. Менеджер — только для чтения: это автор заказа,
 * имя приходит из его профиля при создании, а не набирается руками.
 */
export default function ClientTab({ order, readOnly, onChange, focusFirst = false, onFocused }) {
  const firstRef = useRef(null);
  // Первое поле получает фокус, только когда сюда пришли кнопкой «Далее»;
  // стрелки и клик по вкладке фокус с tablist не уводят (WAI-ARIA Tabs).
  useEffect(() => {
    if (!focusFirst) return;
    if (!readOnly) firstRef.current?.focus();
    onFocused?.();
    // только при монтировании вкладки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <fieldset className={styles.fieldset} disabled={readOnly}>
      <section className={sales.panel} aria-labelledby="wp-client-head">
        <h2 id="wp-client-head" className={sales.panelTitle}>Клиент и заказ</h2>
        <div className={sales.grid2}>
          <label className={sales.field}>Клиент
            <input ref={firstRef} className={sales.input} value={order.customer} onChange={(e) => onChange({ customer: e.target.value })} />
          </label>
          <label className={sales.field}>Контакт
            <input className={sales.input} value={order.contact} onChange={(e) => onChange({ contact: e.target.value })} placeholder="Имя, телефон" />
          </label>
          <label className={sales.field}>Название заказа
            <input className={sales.input} value={order.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Клиент · изделие" />
          </label>
          <label className={sales.field}>Менеджер
            <input className={sales.input} value={order.manager || ''} readOnly placeholder="не указан" />
          </label>
          <label className={sales.field}>Сделка Bitrix
            <input className={sales.input} value={order.bitrix_id} onChange={(e) => onChange({ bitrix_id: e.target.value })} placeholder="[12345]" />
          </label>
          <label className={sales.field}>Срок (дата в КП)
            <input className={sales.input} type="date" value={order.due_date} onChange={(e) => onChange({ due_date: e.target.value })} />
          </label>
          <label className={sales.field}>Срочный пошив
            <select
              className={sales.select}
              value={orderUrgentDays(order)}
              onChange={(e) => { const d = Number(e.target.value); onChange({ urgent_days: d, urgent: d > 0 }); }}
            >
              {URGENT_DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>{d === 0 ? 'Обычный срок' : `На ${d} дней раньше (+${Math.round(URGENT_BY_DAYS[d] * 100)} % к изделию)`}</option>
              ))}
            </select>
          </label>
          <DiscountField discount={order.discount} onChange={(discount) => onChange({ discount })} />
        </div>
      </section>

      <section className={sales.panel} aria-labelledby="wp-delivery-head">
        <h2 id="wp-delivery-head" className={sales.panelTitle}>Доставка и упаковка заказа</h2>
        <div className={sales.grid2}>
          <label className={sales.field}>Доставка
            <select className={sales.select} value={order.delivery_method} onChange={(e) => onChange({ delivery_method: e.target.value })}>
              <option value="">—</option>
              <option value="pickup">Самовывоз</option>
              <option value="courier">Курьер</option>
              <option value="carrier">Транспортная компания</option>
            </select>
          </label>
          <label className={sales.field}>Адрес
            <input className={sales.input} value={order.delivery_address} onChange={(e) => onChange({ delivery_address: e.target.value })} />
          </label>
          <label className={sales.field}>Упаковка
            <select className={sales.select} value={order.packaging} onChange={(e) => onChange({ packaging: e.target.value })}>
              {PACKAGING_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <label className={sales.field}>Требования к упаковке
            <input className={sales.input} value={order.packaging_note} onChange={(e) => onChange({ packaging_note: e.target.value })} />
          </label>
          <label className={sales.check}>
            <input type="checkbox" checked={order.no_chestny_znak} onChange={(e) => onChange({ no_chestny_znak: e.target.checked })} />
            Без «Честного знака»
          </label>
        </div>
      </section>
    </fieldset>
  );
}
